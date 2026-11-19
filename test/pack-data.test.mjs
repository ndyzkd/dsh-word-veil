import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseWordlist } from '../tools/lib/wordlists.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (name) => JSON.parse(readFileSync(join(ROOT, name), 'utf8'))
const index = read('packs/index.json')
const report = read('data/report.json')

const PACK_IDS = ['primary', 'ket', 'pet', 'gaokao', 'cet4', 'cet6', 'kaoyan']
const config = read('packs.config.json')
const MIN_WORDS = new Map(config.packs.map((pack) => [pack.id, pack.minWords]))

test('index has all age/level packs with source and license metadata', () => {
  assert.deepEqual(index.map((pack) => pack.id), PACK_IDS)
  for (const pack of index) {
    assert.ok(pack.wordCount >= MIN_WORDS.get(pack.id), `${pack.id} count`)
    assert.ok(pack.coreCount > 0 && pack.coreCount <= pack.wordCount)
    assert.match(pack.license, /MIT/)
    assert.match(pack.source, /ECDICT/)
    assert.equal(pack.file, `${pack.id}.json`)
  }
})

test('age/level packs retain basic vocabulary and reject PDF fragments', () => {
  const primary = read('packs/primary.json')
  const pet = read('packs/pet.json')
  const ket = read('packs/ket.json')
  const primaryWords = new Set(primary.words.map((word) => word.w))
  const petWords = new Set(pet.words.map((word) => word.w))
  const ketWords = new Set(ket.words.map((word) => word.w))
  for (const word of ['a', 'an', 'hello', 'good', 'student', 'write', 'open', 'number', 'white', 'mum']) {
    assert.ok(primaryWords.has(word), `primary keeps ${word}`)
    assert.ok(petWords.has(word), `pet keeps ${word}`)
  }
  for (const fragment of ['n', 'v', 'nt', 'ts']) {
    assert.equal(ketWords.has(fragment), false, `ket excludes ${fragment}`)
  }
})

test('report counts match the packs and include a source hash', () => {
  assert.match(report.source.sha256, /^[0-9a-f]{64}$/)
  assert.equal(report.source.license, 'MIT')
  for (const pack of index) {
    const data = read(`packs/${pack.file}`)
    assert.equal(data.wordCount, pack.wordCount)
    assert.equal(data.coreCount, pack.coreCount)
    assert.equal(data.words.length, pack.wordCount)
    assert.equal(data.core.length, pack.coreCount)
    const seen = new Set()
    for (const word of data.words) {
      assert.ok(word.w && word.cn, `${pack.id}/${word.w} has word and Chinese meaning`)
      assert.equal(seen.has(word.w), false, `${pack.id}/${word.w} is unique`)
      seen.add(word.w)
    }
    const core = new Set(data.core)
    assert.equal(core.size, data.core.length, `${pack.id} core is unique`)
    for (const word of data.core) assert.ok(seen.has(word), `${pack.id}/${word} core is in words`)
  }
})

test('committed packs cover every verified syllabus headword', () => {
  for (const pack of index) {
    const source = readFileSync(join(ROOT, 'data', 'verified', `${pack.id}.txt`), 'utf8')
    const verified = parseWordlist(source).single
    const data = read(`packs/${pack.file}`)
    const words = new Set(data.words.map((word) => word.w))
    const missing = [...verified].filter((word) => !words.has(word))
    assert.equal(missing.length, 0, `${pack.id} missing ${missing.slice(0, 5).join(', ')}`)
    assert.equal(data.wordCount, verified.size)
    assert.equal(report.verification[pack.id].missing, 0)
  }
})

test('committed packs keep a useful phonetic and part-of-speech coverage', () => {
  for (const pack of report.packs) {
    assert.ok(pack.withPhonetic / pack.words >= 0.85, `${pack.id} phonetic coverage`)
    assert.ok(pack.withPos / pack.words >= 0.9, `${pack.id} pos coverage`)
  }
})
