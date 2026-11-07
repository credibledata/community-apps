// Wikitext table parsing for the 2026 election articles.

import { readJson } from './lib.mjs'

export const wikitext = (name) => readJson(name).parse.wikitext

/** Split on `sep` only outside {{templates}} and [[links]]. */
export function topSplit(s, sep = '|') {
  const out = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2)
    if (two === '{{' || two === '[[') {
      depth++
      cur += two
      i++
      continue
    }
    if ((two === '}}' || two === ']]') && depth > 0) {
      depth--
      cur += two
      i++
      continue
    }
    if (depth === 0 && s[i] === sep) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += s[i]
  }
  out.push(cur)
  return out
}

/** A cell's content without its leading `attr=... |` part. */
export function cellValue(cell) {
  const parts = topSplit(cell)
  if (parts.length > 1 && /=|^\s*\{\{\s*(party shading|shading|small)/i.test(parts[0]) && !/\{\{Party stripe/i.test(parts[0])) {
    return parts.slice(1).join('|').trim()
  }
  return cell.trim()
}

/**
 * Rows of a wikitable starting at the first `{|` after `from`: each row is
 * { header, cells }, where cells are the raw `|`-lines (multi-line cells joined).
 */
export function tableRows(text, from = 0) {
  const start = text.indexOf('{|', from)
  let depth = 0
  let end = start
  for (let i = start; i < text.length; i++) {
    if (text.startsWith('{|', i)) {
      depth++
    } else if (text.startsWith('|}', i) && (i === 0 || text[i - 1] === '\n')) {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const body = text.slice(start, end)
  return body
    .split(/\n\|-[^\n]*/)
    .slice(1)
    .map((chunk) => {
      const lines = chunk.replace(/<!--.*?-->/g, '').split('\n')
      const cells = []
      let header = null
      for (const rawLine of lines) {
        const line = rawLine.replace(/^\s+(?=[!|])/, '')
        if (line.startsWith('!')) {
          if (header === null) {
            header = line.slice(1)
          } else {
            cells.push(line.slice(1))
          }
        } else if (line.startsWith('|')) {
          // `|| a || b` inline cells
          for (const c of line.slice(1).split('||')) {
            cells.push(c)
          }
        } else if (cells.length) {
          cells[cells.length - 1] += `\n${line}`
        } else if (header !== null) {
          header += `\n${line}`
        }
      }
      return { header, cells, raw: chunk }
    })
    .filter((r) => r.header !== null || r.cells.length)
}

/** Index of the section heading `title` (any level). */
export function sectionAt(text, title) {
  const re = new RegExp(`\\n=+\\s*${title.replace(/[()]/g, '\\$&')}\\s*=+\\s*\\n`)
  const m = re.exec(text)
  return m ? m.index : -1
}
