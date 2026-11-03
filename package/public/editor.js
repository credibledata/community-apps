// A quiet, read-only Malloy code block in light mode.

import { esc } from './publisher.js'

const TOKEN = new RegExp(
  [
    String.raw`(?<comment>\/\/[^\n]*)`,
    String.raw`(?<note>#[^\n]*)`,
    String.raw`(?<str>'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")`,
    String.raw`(?<num>@\d{4}-\d{2}-\d{2}|\b\d+(?:\.\d+)?\b)`,
    String.raw`(?<kw>\b(?:source|run|query|view|dimension|measure|primary_key|join_one|join_many|join_cross|where|group_by|aggregate|order_by|limit|select|nest|having|calculate|rename|except|accept|index|sample|top):)`,
    String.raw`(?<op>\b(?:is|and|or|not|pick|when|else|extend|with|on|to|desc|asc|null|true|false)\b)`,
    String.raw`(?<def>\b[A-Za-z_]\w*(?=\s+is\b))`,
  ].join('|'),
  'g'
)

/** Malloy as highlighted HTML. */
export function highlightMalloy(text) {
  let out = ''
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    const kind = Object.keys(m.groups).find((k) => m.groups[k] !== undefined)
    out += esc(text.slice(last, m.index)) + `<span class="t-${kind}">${esc(m[0])}</span>`
    last = m.index + m[0].length
  }
  return out + esc(text.slice(last))
}

export const codeBlock = (text) => `<pre class="code-block"><code>${highlightMalloy(text)}</code></pre>`
