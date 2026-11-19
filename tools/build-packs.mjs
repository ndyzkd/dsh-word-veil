/** Build packs/*.json + packs/index.json + data/report.json from the cached ECDICT CSV. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPacks } from './lib/pack-build.mjs'
import { parseWordlist } from './lib/wordlists.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CSV = join(ROOT, 'data', 'cache', 'ecdict.csv')
const CONFIG = join(ROOT, 'packs.config.json')
const PACKS_DIR = join(ROOT, 'packs')
const REPORT = join(ROOT, 'data', 'report.json')

function main() {
  if (!existsSync(CSV)) {
    throw new Error(`missing ${CSV}; run: node tools/fetch-wordbank.mjs`)
  }
  const config = JSON.parse(readFileSync(CONFIG, 'utf8'))
  const text = readFileSync(CSV, 'utf8')
  const verified = {}
  const verifiedMeta = {}
  for (const [id, source] of Object.entries(config.verification ?? {})) {
    const path = join(ROOT, source.file)
    if (!existsSync(path)) throw new Error(`missing verified list ${source.file}`)
    const parsed = parseWordlist(readFileSync(path, 'utf8'))
    verified[id] = parsed.single
    verifiedMeta[id] = {
      file: source.file,
      words: parsed.single.size,
      phrases: parsed.phrases.size,
      skipped: parsed.skipped.length,
    }
  }
  const coreSeeds = {}
  for (const pack of config.packs) {
    const path = join(PACKS_DIR, `${pack.id}.json`)
    if (!existsSync(path)) continue
    try {
      const current = JSON.parse(readFileSync(path, 'utf8'))
      if (Array.isArray(current.core)) coreSeeds[pack.id] = current.core
    } catch { /* a broken seed is not fatal; frequency fills the core */ }
  }
  const { packs, report } = buildPacks(text, config, { verified, coreSeeds })
  report.verifiedLists = verifiedMeta
  mkdirSync(PACKS_DIR, { recursive: true })
  const index = []
  for (const pack of packs) {
    const file = `${pack.id}.json`
    writeFileSync(join(PACKS_DIR, file), JSON.stringify(pack), 'utf8')
    index.push({
      id: pack.id,
      name: pack.name,
      nameEn: pack.nameEn,
      category: pack.category,
      version: pack.version,
      wordCount: pack.wordCount,
      coreCount: pack.coreCount,
      source: pack.source,
      license: pack.license,
      updatedAt: pack.updatedAt,
      file,
    })
    console.log(`[packs] ${pack.id}: ${pack.wordCount} words, ${pack.coreCount} core`)
  }
  writeFileSync(join(PACKS_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8')
  writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(`[packs] wrote ${PACKS_DIR}/index.json and ${REPORT}`)
}

try {
  main()
} catch (error) {
  console.error(`[packs] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
