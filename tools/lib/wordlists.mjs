/** Parse an exam headword list (one entry per line, optional [phonetic] and Chinese senses). */
const WORD_RE = /^[a-z][a-z'-]*$/

/**
 * Extract single-word and phrase headwords from a plain-text vocabulary list.
 * Entries may look like `abandon [əˈbændən] vt.丢弃` or `a art.一(个)`.
 */
export function parseWordlist(text) {
  const single = new Set()
  const phrases = new Set()
  const skipped = []
  for (const raw of String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (/^[A-Z]$/.test(line) || /^\(共/.test(line) || /单词表/.test(line)) continue
    if (WORD_RE.test(line)) {
      single.add(line)
      continue
    }
    let head = ''
    const bracket = line.indexOf('[')
    if (bracket > 0) {
      head = line.slice(0, bracket).trim()
    } else {
      const match = line.match(/^(.+?)\s+(?:a|ad|art|aux|conj|n|v|vt|vi|pron|prep|num|int|adj|adv|pl)\./)
      if (match) head = match[1].trim()
    }
    head = head.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
    if (!head) {
      skipped.push(line.slice(0, 80))
      continue
    }
    if (head.includes(' ')) phrases.add(head)
    else if (WORD_RE.test(head)) single.add(head)
    else skipped.push(line.slice(0, 80))
  }
  return { single, phrases, skipped }
}

export { WORD_RE }
