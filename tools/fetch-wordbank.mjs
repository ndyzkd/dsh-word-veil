/**
 * Download ECDICT once into data/cache/ecdict.csv.
 * The runtime plugin never downloads anything; this is a build-time step.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DEST_DIR = join(ROOT, 'data', 'cache')
const DEST = join(DEST_DIR, 'ecdict.csv')
const TMP = `${DEST}.tmp`
const MIN_BYTES = 60 * 1024 * 1024

const SOURCES = [
  'https://ghfast.top/https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
  'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
]

async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function download(url) {
  console.log(`[fetch] ${url}`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(TMP))
  const size = statSync(TMP).size
  if (size < MIN_BYTES) throw new Error(`downloaded only ${size} bytes`)
  renameSync(TMP, DEST)
  console.log(`[fetch] ${size} bytes -> ${DEST}`)
}

async function main() {
  mkdirSync(DEST_DIR, { recursive: true })
  if (existsSync(DEST) && statSync(DEST).size >= MIN_BYTES && !process.argv.includes('--force')) {
    console.log(`[fetch] reusing ${DEST} (${statSync(DEST).size} bytes)`)
    console.log(`[fetch] sha256 ${await sha256(DEST)}`)
    return
  }
  let lastError
  for (const url of SOURCES) {
    try {
      await download(url)
      console.log(`[fetch] sha256 ${await sha256(DEST)}`)
      return
    } catch (error) {
      lastError = error
      console.warn(`[fetch] failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`could not download ECDICT; last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
