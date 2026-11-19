import test from 'node:test'
import assert from 'node:assert/strict'
import { parseWordlist } from '../tools/lib/wordlists.mjs'

test('parseWordlist handles bracket, no-bracket and multiword entries', () => {
  const parsed = parseWordlist(`
大学英语四级大纲单词表
(共 3 词)
A
a art.一(个)
abandon [əˈbændən] vt.丢弃
according to [əˈkɔːdiŋ tu] prep.根据
`)
  assert.deepEqual([...parsed.single].sort(), ['a', 'abandon'])
  assert.deepEqual([...parsed.phrases], ['according to'])
  assert.equal(parsed.skipped.length, 0)
})
