/**
 * ECDICT CSV -> exam pack data. Pure functions so the build can be tested
 * without downloading the 66 MB source file.
 */
import { createHash } from 'node:crypto'

const WORD_RE = /^[A-Za-z][A-Za-z'-]*$/
const CJK_RE = /[\u4e00-\u9fff]/

/** Normalize a Chinese translation cell; drop corpus/domain tags such as [经]. */
export function cleanTranslation(value) {
  const normalized = String(value ?? '')
    .replace(/\\n/g, '；')
    .replace(/\\r/g, '；')
    .replace(/\r?\n/g, '；')
    .replace(/\s+/g, ' ')
    .replace(/\s*；\s*/g, '；')
    .replace(/；{2,}/g, '；')
    .trim()
  const withoutDomain = normalized.replace(/\[[^\]]{1,12}\][^；;]*/g, '')
  const chosen = CJK_RE.test(withoutDomain) ? withoutDomain : normalized.replace(/\[[^\]]{1,12}\]/g, '')
  return chosen
    .replace(/\[[^\]]{1,12}\]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*；\s*/g, '；')
    .replace(/；{2,}/g, '；')
    .replace(/^[；;,\s]+|[；;,\s]+$/g, '')
    .slice(0, 180)
    .trim()
}

/** Normalize ECDICT's ASCII-ish phonetic spelling into readable IPA symbols. */
export function cleanPhonetic(value) {
  return String(value ?? '')
    .trim()
    .replace(/^\/|\/$/g, '')
    .replace(/ә/g, 'ə')
    .replace(/:/g, 'ː')
    .replace(/ɒː/g, 'ɔː')
    .replace(/əː/g, 'ɜː')
    .replace(/'/g, 'ˈ')
    .replace(/,/g, 'ˌ')
    .replace(/ˈ{2,}/g, 'ˈ')
    .trim()
}

/** Parse dictionary part-of-speech prefixes from the Chinese translation. */
export function parsePos(translation, corpusPos) {
  const map = {
    n: 'n.', v: 'v.', vt: 'vt.', vi: 'vi.', adj: 'adj.', a: 'adj.',
    adv: 'adv.', ad: 'adv.', prep: 'prep.', pron: 'pron.', conj: 'conj.',
    num: 'num.', art: 'art.', int: 'int.', aux: 'aux.', abbr: 'abbr.',
  }
  const found = []
  const re = /(?:^|[；;])\s*(n|vt|vi|v|adj|a|adv|ad|prep|pron|conj|num|art|int|aux|abbr)\./gi
  for (const match of String(translation ?? '').matchAll(re)) {
    const code = map[String(match[1]).toLowerCase()]
    if (code && !found.includes(code)) found.push(code)
    if (found.length >= 3) break
  }
  if (found.length > 0) return found.join(' ')
  // Fall back to ECDICT's corpus distribution, e.g. "n:46/v:54".
  const counts = new Map()
  for (const part of String(corpusPos ?? '').split('/')) {
    const [tag, raw] = part.split(':')
    const key = String(tag ?? '').trim().toLowerCase()
    const n = Number(raw)
    if (!key || !Number.isFinite(n)) continue
    const code = key === 'a' ? 'adj.' : key === 'r' ? 'adv.' : map[key]
    if (code) counts.set(code, (counts.get(code) ?? 0) + n)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([code]) => code)
    .join(' ')
}

/** Lower is more common. */
export function rankOf(frq, bnc) {
  const a = Number(frq)
  if (Number.isFinite(a) && a > 0) return a
  const b = Number(bnc)
  if (Number.isFinite(b) && b > 0) return b
  return 999999
}

/** Quote-aware CSV row iterator. Handles embedded newlines and doubled quotes. */
export function* csvRows(text) {
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      yield row
      row = []
      field = ''
    } else if (ch !== '\r') {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    yield row
  }
}

/** Build all configured packs from ECDICT CSV text. */
export function buildPacks(text, config, { verified = null, coreSeeds = {} } = {}) {
  const rows = csvRows(text)
  const header = rows.next()
  if (header.done) throw new Error('ecdict.csv is empty')
  const cols = header.value.map((name) => name.trim())
  const at = (name) => {
    const index = cols.indexOf(name)
    if (index < 0) throw new Error(`ecdict.csv is missing column: ${name}`)
    return index
  }
  const iWord = at('word')
  const iPhonetic = at('phonetic')
  const iTranslation = at('translation')
  const iPos = at('pos')
  const iTag = at('tag')
  const iBnc = at('bnc')
  const iFrq = at('frq')

  const targets = config.packs
  const maps = new Map(targets.map((pack) => [pack.id, new Map()]))
  const verifiedSets = verified
    ? new Map(targets.map((pack) => [pack.id, verified[pack.id] ?? new Set()]))
    : null
  const seen = new Map() // word -> { ph, cn, pos, rank }
  let scanned = 0
  let skipped = 0

  for (const row of rows) {
    scanned++
    if (row.length <= iWord) continue
    const word = String(row[iWord] ?? '').trim()
    if (!WORD_RE.test(word)) continue
    const key = word.toLowerCase()
    let memberPacks
    if (verifiedSets) {
      memberPacks = targets.filter((pack) => verifiedSets.get(pack.id).has(key))
    } else {
      const tags = String(row[iTag] ?? '').trim().split(/\s+/)
      memberPacks = targets.filter((pack) => tags.includes(pack.tag))
    }
    if (memberPacks.length === 0) continue
    const cn = cleanTranslation(row[iTranslation])
    if (!cn || !CJK_RE.test(cn)) {
      skipped++
      continue
    }
    const entry = seen.get(key) ?? {
      w: key,
      ph: cleanPhonetic(row[iPhonetic]),
      pos: parsePos(cn, row[iPos]),
      cn,
      rank: rankOf(row[iFrq], row[iBnc]),
    }
    if (!seen.has(key)) seen.set(key, entry)
    for (const pack of memberPacks) {
      const map = maps.get(pack.id)
      if (!map.has(key)) map.set(key, entry)
    }
  }

  const packs = []
  const verification = {}
  for (const pack of targets) {
    const words = [...maps.get(pack.id).values()]
    if (words.length < pack.minWords) {
      throw new Error(`${pack.id}: only ${words.length} words, need >= ${pack.minWords}`)
    }
    if (verifiedSets) {
      const missing = [...verifiedSets.get(pack.id)].filter((word) => !maps.get(pack.id).has(word))
      verification[pack.id] = {
        listWords: verifiedSets.get(pack.id).size,
        missing: missing.length,
        missingSample: missing.slice(0, 30),
      }
    }
    const withPh = words.filter((word) => word.ph !== '').length
    const withPos = words.filter((word) => word.pos !== '').length
    if (withPh / words.length < 0.85) {
      throw new Error(`${pack.id}: phonetic coverage ${(withPh / words.length * 100).toFixed(1)}% < 85%`)
    }
    if (withPos / words.length < 0.9) {
      throw new Error(`${pack.id}: part-of-speech coverage ${(withPos / words.length * 100).toFixed(1)}% < 90%`)
    }
    words.sort((a, b) => a.w.localeCompare(b.w, 'en'))
    const seed = new Set(coreSeeds[pack.id] ?? [])
    const seeded = words
      .filter((word) => seed.has(word.w))
      .sort((a, b) => a.rank - b.rank || a.w.localeCompare(b.w, 'en'))
    const rest = words
      .filter((word) => !seed.has(word.w))
      .sort((a, b) => a.rank - b.rank || a.w.localeCompare(b.w, 'en'))
    const core = [...seeded, ...rest].slice(0, pack.coreSize).map((word) => word.w)
    packs.push({
      schema: 1,
      id: pack.id,
      name: pack.name,
      nameEn: pack.nameEn,
      category: pack.category,
      version: config.dataVersion,
      source: verifiedSets
        ? (config.verification?.[pack.id]?.source ?? 'verified headwords')
        : `ECDICT tag=${pack.tag}`,
      license: verifiedSets
        ? `${config.source.license} (ECDICT metadata); ${config.verification?.[pack.id]?.license ?? 'headword list attribution'}`
        : `${config.source.license} (ECDICT)`,
      updatedAt: config.dataVersion,
      wordCount: words.length,
      coreCount: core.length,
      core,
      words,
    })
  }

  const hash = createHash('sha256').update(text).digest('hex')
  const report = {
    builtAt: config.dataVersion,
    source: {
      name: config.source.name,
      url: config.source.url,
      license: config.source.license,
      file: config.source.file,
      bytes: Buffer.byteLength(text, 'utf8'),
      sha256: hash,
    },
    scannedRows: scanned,
    skippedRows: skipped,
    verification: verifiedSets ? verification : undefined,
    packs: packs.map((pack) => ({
      id: pack.id,
      words: pack.wordCount,
      core: pack.coreCount,
      withPhonetic: pack.words.filter((word) => word.ph !== '').length,
      withPos: pack.words.filter((word) => word.pos !== '').length,
    })),
    notes: [
      verifiedSets
        ? 'Membership comes from sourced syllabus headwords; ECDICT supplies phonetics, POS and Chinese meanings.'
        : 'Membership comes from ECDICT tags.',
      'Core starts from the previous core seed and fills by ECDICT frequency; it is not an official syllabus order.',
      'No example sentences are bundled; context comes from where the learner met the word.',
    ],
  }
  return { packs, report }
}
