// The part of the page the reader can actually see, as --view-top and --view-h on <html>.
//
// Embedded in Credible, the frame grows to the page's full height and the host page scrolls
// instead, so `position: fixed`, `100dvh` and window scroll events all describe the whole page,
// not the screen. The host is cross-origin and sends no scroll position, but IntersectionObserver
// still clips to the top-level viewport across origins: thin strips down the frame report which
// band of it is on screen. Standalone, the band is just the window.

export const embedded = (() => {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
})()

// Credible pins its breadcrumb header over the top of the scroller the frame scrolls in, and
// IntersectionObserver cannot see what overlaps the frame. Once the frame's top has scrolled
// above the scroller's edge, that much of the band is under the header.
const HOST_HEADER = 56
const STRIP = 20
const THRESHOLDS = Array.from({ length: 11 }, (_, i) => i / 10)
const listeners = new Set()
let band = { top: 0, height: window.innerHeight }

/** The visible band in this document's client coordinates. */
export function visibleBand() {
  return embedded ? band : { top: 0, height: window.innerHeight }
}

/** Calls `fn` whenever the visible band moves or resizes. */
export function onVisibleBand(fn) {
  listeners.add(fn)
  if (!embedded) {
    window.addEventListener('scroll', fn, { passive: true })
    window.addEventListener('resize', fn)
  }
}

/**
 * Stops wheel and touch scrolling over `els` from reaching the page behind. `body.modal-open`
 * does that standalone, but embedded it is the host page that scrolls, and only the event can.
 */
export function holdHostScroll(...els) {
  for (const el of els) {
    for (const type of ['wheel', 'touchmove']) {
      el.addEventListener(type, (e) => e.preventDefault(), { passive: false })
    }
  }
}

function publish(next) {
  if (next.top === band.top && next.height === band.height) {
    return
  }
  band = next
  const root = document.documentElement.style
  root.setProperty('--view-top', `${band.top}px`)
  root.setProperty('--view-h', `${band.height}px`)
  for (const fn of listeners) {
    fn()
  }
}

function track() {
  document.documentElement.classList.add('embedded')
  // Fixed and outside <body>, so it never counts toward the height the frame reports.
  const rail = document.createElement('div')
  rail.setAttribute('aria-hidden', 'true')
  rail.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:100%;visibility:hidden;pointer-events:none'
  document.documentElement.append(rail)

  const seen = new Map()
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        seen.set(e.target, e.isIntersecting && e.intersectionRect.height > 0 ? e.intersectionRect : null)
      }
      let top = Infinity
      let bottom = -Infinity
      for (const r of seen.values()) {
        if (r) {
          top = Math.min(top, r.top)
          bottom = Math.max(bottom, r.bottom)
        }
      }
      // Scrolled fully out of view: keep the last band rather than collapse to nothing.
      if (bottom > top) {
        const under = top > 0 ? Math.min(HOST_HEADER, bottom - top) : 0
        publish({ top: Math.round(top + under), height: Math.round(bottom - top - under) })
      }
    },
    { threshold: THRESHOLDS },
  )

  let built = 0
  const build = () => {
    const n = Math.ceil(window.innerHeight / STRIP)
    if (n === built) {
      return
    }
    built = n
    io.disconnect()
    seen.clear()
    rail.replaceChildren()
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div')
      s.style.cssText = `position:absolute;left:0;width:1px;top:${i * STRIP}px;height:${STRIP}px`
      rail.append(s)
      io.observe(s)
    }
  }
  build()
  window.addEventListener('resize', build)
}

if (embedded && 'IntersectionObserver' in window) {
  track()
}
