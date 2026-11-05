// Front door for the container.
//
// Publisher serves this package's app four levels deep, at
// /environments/<env>/packages/<pkg>/index.html, and its own console at "/".
// The load balancer rewrites /elections -> / before the request arrives, so
// without this the public URL would land on that console — which loads its
// assets from absolute /assets/... and so breaks under the prefix anyway.
//
// This serves the app's own files at "/", proxies the query endpoints it
// needs and passes on the models' source text, so the public URL is just
// https://<host>/elections and the app needs no knowledge of how deep Publisher
// files it. Everything else Publisher serves is refused here — see QUERY_PATHS below.

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const PORT = Number(process.env.PORT || 8080)
const PUBLISHER_PORT = Number(process.env.PUBLISHER_PORT || 4000)
const ENVIRONMENT = process.env.PUBLISHER_ENV || 'elections'
const PACKAGE = process.env.PACKAGE_NAME || 'midterms2026'
const PUBLIC_DIR = new URL('./package/public/', import.meta.url).pathname

// The only upstream paths this app proxies: one query endpoint per model, the
// forecast (elections.malloy) and election night (results.malloy, which imports
// it). Everything else Publisher serves is refused here rather than forwarded:
// its REST surface includes a connection endpoint that runs arbitrary SQL and
// config routes that can unload the package for every visitor. None of that
// should be reachable from the public URL just because the app runs queries.
const MODEL_PATHS = ['elections.malloy', 'forecast.malloy', 'results.malloy'].map(
  (m) => `/api/v0/environments/${ENVIRONMENT}/packages/${PACKAGE}/models/${m}`
)
const QUERY_PATHS = new Set(MODEL_PATHS.map((p) => `${p}/query`))

// The methodology and results pages also read a model's source text, to show what each named
// query expands to. Publisher's GET on a model returns that alongside ~1 MB of compiled model
// (with server file paths), so only { sourceText } is passed on, fetched once per process.
const modelSources = new Map()

// Readiness. Cloud Run's startup probe asks for this path, and the container is
// not "ready" until Publisher answers on it.
//
// That distinction is the whole point. This process binds its port in
// milliseconds, but it serves nothing useful until Publisher — a separate
// process in the same container, several seconds of boot away — is listening.
// A TCP probe on this port passes immediately and so declares the container
// ready while Publisher is still starting. Cloud Run then withdraws CPU
// (cpu_idle), and Publisher's remaining boot runs on whatever CPU an arriving
// request happens to grant it: observed in production as a boot that took six
// minutes on one instance, eighteen on another, and never finished on the rest,
// so every query 502'd. Probing through to Publisher keeps the container in
// startup, where CPU is held and boosted, until it can genuinely serve.
const READY_PATH = '/healthz'

// Publisher's own status route. Cheap, and unlike the query endpoint it runs no
// model, so it does not make readiness wait on a warm query. It 503s while
// Publisher's storage is still initialising, which is exactly the window this
// probe exists to wait out.
const UPSTREAM_READY_PATH = '/api/v0/status'

// Readiness only ever goes false -> true: a process that has served once is
// started, and re-checking on every probe would put upstream requests in the
// path of a route called every few seconds for the life of the instance.
let publisherReady = false

/** True once Publisher is listening and answering. Latches. */
async function checkPublisher() {
  if (publisherReady) return true
  const { request } = await import('node:http')
  return new Promise((resolve) => {
    const probe = request(
      {
        host: '127.0.0.1',
        port: PUBLISHER_PORT,
        path: UPSTREAM_READY_PATH,
        method: 'GET',
        timeout: 2000,
      },
      (up) => {
        up.resume()
        // Only a 200 counts. Publisher answers 503 here while it is still
        // initialising, and latching on anything short of success would
        // declare the container ready in exactly the state we are waiting out.
        if (up.statusCode === 200) publisherReady = true
        resolve(publisherReady)
      }
    )
    probe.on('timeout', () => probe.destroy())
    probe.on('error', () => resolve(false))
    probe.end()
  })
}

// Per-client limit on that endpoint. Static files are not counted: they are
// cheap, and a page load fetches several.
//
// This is the only per-caller bound the app has. The endpoint takes arbitrary
// Malloy from anyone — a page load issues about twenty fixed queries and each
// race drawer three more, but nothing stops a caller writing their own — so
// "the UI only asks for X" is not a limit. Every source is a small CSV (the
// largest is ~11k rows), so queries are cheap, and max_instances caps the
// spend; this is the layer that keeps one caller from crowding out everyone
// else.
const RATE_LIMIT = Number(process.env.QUERY_RATE_LIMIT || 120)
const RATE_WINDOW_MS = Number(process.env.QUERY_RATE_WINDOW_MS || 60_000)
const hits = new Map()

/**
 * The caller's address as the load balancer saw it.
 *
 * Behind the balancer every request reaches this process from one proxy
 * address, so the socket's remote address is the same for every visitor on
 * earth and keying on it would make this one global bucket. GCP appends the
 * client to X-Forwarded-For and the balancer's own address after it, so the
 * client is the second-from-last entry; falling back to the last, then to the
 * socket, keeps this working when run directly.
 */
function clientKey(req) {
  const forwarded = (req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return (
    forwarded.at(-2) ||
    forwarded.at(-1) ||
    req.socket.remoteAddress ||
    'unknown'
  )
}

/** True when this caller is over the limit. Sweeps expired windows as it goes. */
function overLimit(key, now) {
  for (const [k, seen] of hits) {
    if (now - seen.start >= RATE_WINDOW_MS) hits.delete(k)
  }
  const seen = hits.get(key)
  if (!seen || now - seen.start >= RATE_WINDOW_MS) {
    hits.set(key, { start: now, count: 1 })
    return false
  }
  seen.count += 1
  return seen.count > RATE_LIMIT
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

/** Resolve a request path inside public/, or null if it escapes the directory. */
function resolveStatic(urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    // A malformed percent-escape ("/%FF") throws URIError. Unhandled, that
    // rejects inside the request handler and takes the process down, leaving
    // the container Up with a dead port and nothing to recycle it.
    return null
  }
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, '')
  const file = join(PUBLIC_DIR, rel === '/' ? 'index.html' : rel)
  return file.startsWith(PUBLIC_DIR) ? file : null
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    // Nothing in handle() is expected to throw, but an uncaught rejection here
    // ends the process and the container keeps running with a closed port.
    console.error('[serve] request failed', err)
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain' })
    }
    res.end('internal error\n')
  })
})

async function handle(req, res) {
  const path = (req.url || '/').split('?')[0]

  if (path === READY_PATH) {
    const ready = await checkPublisher()
    res.writeHead(ready ? 200 : 503, { 'content-type': 'text/plain' })
    return res.end(ready ? 'ready\n' : 'publisher starting\n')
  }

  if (req.method === 'GET' && MODEL_PATHS.includes(path)) {
    return serveModelSource(res, path)
  }

  // Everything the app itself asks for, served from public/ at the root.
  if (req.method === 'GET' || req.method === 'HEAD') {
    const file = resolveStatic(path)
    if (file) {
      try {
        const body = await readFile(file)
        res.writeHead(200, {
          'content-type': TYPES[extname(file)] || 'application/octet-stream',
          // The app is redeployed as a whole image; its files are not
          // fingerprinted, so they must not be cached across a deploy.
          'cache-control': 'no-cache',
        })
        return res.end(req.method === 'HEAD' ? undefined : body)
      } catch {
        // Not a file we hold: fall through to the 404 below.
      }
    }
  }

  // Only the query endpoints are proxied. Anything else is this app's own 404,
  // not Publisher's — see QUERY_PATHS above for why the rest stays unreachable.
  if (req.method !== 'POST' || !QUERY_PATHS.has(path)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify({ message: 'Not found' }))
  }

  if (overLimit(clientKey(req), Date.now())) {
    res.writeHead(429, {
      'content-type': 'application/json; charset=utf-8',
      'retry-after': String(Math.ceil(RATE_WINDOW_MS / 1000)),
    })
    return res.end(
      JSON.stringify({ message: 'Too many queries. Try again shortly.' })
    )
  }

  const upstream = {
    host: '127.0.0.1',
    port: PUBLISHER_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${PUBLISHER_PORT}` },
  }
  const proxied = (await import('node:http')).request(upstream, (up) => {
    res.writeHead(up.statusCode || 502, up.headers)
    up.pipe(res)
  })
  proxied.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain' })
    res.end(`upstream unavailable: ${err.message}\n`)
  })
  req.pipe(proxied)
}

/** A model's source text only, from Publisher's model route. Cached once it succeeds. */
async function serveModelSource(res, modelPath) {
  if (!modelSources.get(modelPath)) {
    const { request } = await import('node:http')
    modelSources.set(modelPath, await new Promise((resolve) => {
      const up = request({ host: '127.0.0.1', port: PUBLISHER_PORT, path: modelPath, method: 'GET', timeout: 10_000 }, (r) => {
        const chunks = []
        r.on('data', (c) => chunks.push(c))
        r.on('end', () => {
          try {
            const { sourceText } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            resolve(r.statusCode === 200 && typeof sourceText === 'string' ? JSON.stringify({ sourceText }) : null)
          } catch {
            resolve(null)
          }
        })
      })
      up.on('timeout', () => up.destroy())
      up.on('error', () => resolve(null))
      up.end()
    }))
  }
  const body = modelSources.get(modelPath)
  if (!body) {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify({ message: 'Model unavailable' }))
  }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
  res.end(body)
}

server.listen(PORT, '0.0.0.0', () => {
  // The port is open. The app is not servable until Publisher is up too, which
  // READY_PATH is what reports — see checkPublisher above.
  console.log(
    `[serve] app at / -> ${PUBLIC_DIR}; proxying to publisher :${PUBLISHER_PORT} ` +
      `(env=${ENVIRONMENT} package=${PACKAGE})`
  )
})
