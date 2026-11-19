import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPacks, cleanPhonetic, cleanTranslation, csvRows, parsePos, rankOf,
} from '../tools/lib/pack-build.mjs'

const CONFIG = {
  dataVersion: 'test',
  source: { name: 'fixture', url: 'https://example.invalid', license: 'MIT', file: 'fixture.csv' },
  packs: [
    { id: 'cet4', tag: 'cet4', name: '四级', nameEn: 'CET-4', category: 'test', coreSize: 2, minWords: 1 },
    { id: 'cet6', tag: 'cet6', name: '六级', nameEn: 'CET-6', category: 'test', coreSize: 2, minWords: 1 },
  ],
}

function fixture() {
  return [
    'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio',
    'ability,ә\'biliti,ability,"n. 能力, 才干；[经] 能力",n:90/v:10,5,1,"cet4 cet6",783,800,,,',
    'reluctant,ri\'lʌktәnt,reluctant,"a. 不情愿的；[法] 勉强的",a:80/n:20,3,0,cet4,3900,4100,,,',
    'deadline,\'dedlain,deadline,"n. 最后期限；[经] 截止日期",n:100,4,0,cet6,4032,4200,,,',
  ].join('\n')
}

test('csvRows handles quotes, doubled quotes and embedded newlines', () => {
  const rows = [...csvRows('a,b\n"x, y","he said ""hi""\nnext"\n')]
  assert.deepEqual(rows[0], ['a', 'b'])
  assert.deepEqual(rows[1], ['x, y', 'he said "hi"\nnext'])
})

test('cleanTranslation removes domain tags and collapses whitespace', () => {
  assert.equal(cleanTranslation('n. 能力；[经] 才能\\n[a] x'), 'n. 能力')
})

test('cleanPhonetic converts ECDICT spelling to readable IPA-ish symbols', () => {
  assert.equal(cleanPhonetic("ә'biliti"), 'əˈbiliti')
  assert.equal(cleanPhonetic('ɒ:'), 'ɔː')
  assert.equal(cleanPhonetic('/riˈlʌktənt/'), 'riˈlʌktənt')
  assert.equal(cleanPhonetic(''), '')
})

test('parsePos reads translation prefixes, then corpus distribution', () => {
  assert.equal(parsePos('n. 能力；vt. 使能够', ''), 'n. vt.')
  assert.equal(parsePos('能力', 'n:80/v:20'), 'n. v.')
  assert.equal(parsePos('', ''), '')
})

test('rankOf prefers frq, falls back to bnc, then a sentinel', () => {
  assert.equal(rankOf('12', '34'), 12)
  assert.equal(rankOf('', '34'), 34)
  assert.equal(rankOf('', ''), 999999)
})

test('buildPacks merges shared words, builds core and report', () => {
  const { packs, report } = buildPacks(fixture(), CONFIG)
  const cet4 = packs.find((pack) => pack.id === 'cet4')
  const cet6 = packs.find((pack) => pack.id === 'cet6')
  assert.equal(cet4.words.length, 2)
  assert.equal(cet6.words.length, 2)
  assert.equal(cet4.words.find((word) => word.w === 'ability').ph, 'əˈbiliti')
  assert.equal(cet4.words.find((word) => word.w === 'ability').cn.includes('[经]'), false)
  assert.deepEqual(cet4.core, ['ability', 'reluctant'])
  assert.equal(cet6.core.length, 2)
  assert.equal(report.source.name, 'fixture')
  assert.match(report.source.sha256, /^[0-9a-f]{64}$/)
  assert.equal(report.packs.length, 2)
})

test('buildPacks can use verified headwords instead of ECDICT tags', () => {
  const verified = {
    cet4: new Set(['reluctant', 'missing-word']),
    cet6: new Set(['deadline']),
  }
  const { packs, report } = buildPacks(fixture(), CONFIG, { verified })
  const cet4 = packs.find((pack) => pack.id === 'cet4')
  const cet6 = packs.find((pack) => pack.id === 'cet6')
  assert.deepEqual(cet4.words.map((word) => word.w), ['reluctant'])
  assert.deepEqual(cet6.words.map((word) => word.w), ['deadline'])
  assert.equal(report.verification.cet4.missing, 1)
  assert.match(cet4.source, /verified|大纲|cet4/i)
})

test('buildPacks refuses a pack below its minimum word count', () => {
  const config = structuredClone(CONFIG)
  config.packs[0].minWords = 99
  assert.throws(() => buildPacks(fixture(), config), /only 2 words/)
})
