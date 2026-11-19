import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addDays, cleanUserText, createService, dayKey, gradeSrs, isMastered, isStubborn, isValidDay, tokensOf,
} from '../src/host.js'

function tempService(options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-word-veil-test-'))
  let clock = new Date()
  const service = createService({
    dataDir,
    logger: { warn() {}, error() {} },
    now: () => clock,
    ...options,
  })
  return {
    dataDir,
    service,
    advance(days) { clock = new Date(clock.getTime() + days * 86400000) },
    cleanup() {
      service.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

test('dayKey/addDays/gradeSrs follow the documented SM-2-lite rules', () => {
  const day = '2026-11-17'
  assert.equal(dayKey(new Date(2026, 10, 17)), day)
  assert.equal(addDays(day, 1), '2026-11-18')
  assert.equal(addDays(day, -1), '2026-11-16')
  assert.equal(isValidDay('2024-02-29'), true)
  assert.equal(isValidDay('2026-02-29'), false)
  assert.equal(isValidDay('2026-13-01'), false)
  assert.equal(isValidDay('2026-04-31'), false)
  let srs = gradeSrs(null, 'good', { retrieval: true, mode: 'en2cn', today: day })
  assert.equal(srs.reps, 1)
  assert.equal(srs.interval, 1)
  assert.equal(srs.due, '2026-11-18')
  srs = gradeSrs(srs, 'good', { retrieval: true, mode: 'cn2en', today: day })
  assert.equal(srs.interval, 3)
  srs = gradeSrs(srs, 'good', { retrieval: true, mode: 'cn2en', today: day })
  assert.equal(srs.interval, 8)
  srs = gradeSrs(srs, 'again', { retrieval: true, mode: 'cn2en', today: day })
  assert.equal(srs.reps, 0)
  assert.equal(srs.interval, 1)
  assert.equal(srs.lapses, 1)
  assert.equal(srs.due, '2026-11-18')
  assert.equal(isStubborn({ ...srs, lapses: 3, wrongStreak: 0 }), false, 'lifetime lapses alone must not make a word permanent')
  assert.equal(isStubborn({ ...srs, wrongStreak: 2 }), true)
  assert.equal(isStubborn({ ...srs, again: 3, good: 1, wrongStreak: 0 }), true)
  assert.equal(isMastered({ ...srs, reps: 3, lastGrade: 'good', retrievalGoodDays: ['a', 'b'], productionGoodDays: ['b'], lapses: 0, ef: 2.5 }), true)
  assert.equal(isMastered({ ...srs, reps: 3, lastGrade: 'good', retrievalGoodDays: ['a', 'b'], productionGoodDays: ['b'], lapses: 12, good: 12, again: 3, wrongStreak: 0, ef: 2.8 }), true, 'a word can recover from old lapses')
})

test('cleanUserText strips code/URLs/paths and tokensOf lowercases', () => {
  const cleaned = cleanUserText('请解释 ```code``` 和 `inline`，见 https://x.test C:\\tmp\\a.txt，Reluctant 是什么意思')
  assert.equal(cleaned.includes('```'), false)
  assert.equal(cleaned.includes('https://'), false)
  assert.equal(cleaned.includes('C:\\'), false)
  const tokens = tokensOf(cleaned)
  assert.equal(tokens.some((token) => token.word === 'reluctant'), true)
})

test('onboarding, add, grade, mastery and idempotency work through commands', () => {
  const ctx = tempService()
  try {
    const onboarding = ctx.service.execute({
      id: 'onboard-1',
      type: 'completeOnboarding',
      payload: { packs: { enabled: ['cet4'], primary: 'cet4' }, daily: { preset: 'standard' } },
    })
    assert.equal(onboarding.ok, true)
    assert.equal(ctx.service.state.settings.onboardingDone, true)
    assert.equal(ctx.service.state.settings.daily.reviewCap, 25)

    const added = ctx.service.execute({ id: 'add-1', type: 'addWord', payload: { w: 'ability' } })
    assert.equal(added.ok, true)
    assert.equal(ctx.service.state.words.ability.cn.startsWith('n. 能力'), true)

    const first = ctx.service.execute({ id: 'grade-1', type: 'gradeWord', payload: { w: 'ability', result: 'good', retrieval: true, mode: 'cn2en' } })
    assert.equal(first.ok, true)
    assert.equal(first.summary.actedToday, true)
    const second = ctx.service.execute({ id: 'grade-2', type: 'gradeWord', payload: { w: 'ability', result: 'good', retrieval: true, mode: 'cn2en' } })
    assert.equal(second.ok, true)
    ctx.advance(1)
    const third = ctx.service.execute({ id: 'grade-3', type: 'gradeWord', payload: { w: 'ability', result: 'good', retrieval: true, mode: 'cn2en' } })
    assert.equal(third.ok, true)
    const ability = ctx.service.state.words.ability
    assert.equal(ability.srs.reps, 3)
    assert.equal(new Set(ability.srs.retrievalGoodDays).size, 2)
    assert.equal(new Set(ability.srs.productionGoodDays).size, 2)
    assert.equal(isMastered(ability.srs), true)

    const duplicate = ctx.service.execute({ id: 'grade-3', type: 'gradeWord', payload: { w: 'ability', result: 'again', retrieval: true, mode: 'en2cn' } })
    assert.equal(duplicate.duplicate, true)
    assert.equal(ctx.service.state.words.ability.srs.lastGrade, 'good')
  } finally {
    ctx.cleanup()
  }
})

test('corrupt wordbook is renamed and the service starts from a safe state', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-word-veil-corrupt-'))
  writeFileSync(join(dataDir, 'wordbook.json'), '{ not json', 'utf8')
  const service = createService({ dataDir, logger: { warn() {}, error() {} } })
  try {
    assert.equal(service.corrupt, true)
    assert.equal(service.summary().corrupt, true)
  } finally {
    service.dispose()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('auto-capture handles lookup, short, long, exclusions and disabled mode', () => {
  const ctx = tempService()
  try {
    ctx.service.execute({ id: 'onboard-2', type: 'completeOnboarding', payload: { packs: { enabled: ['cet4'], primary: 'cet4' }, autoCapture: { enabled: true, excludeCwdPatterns: ['excluded-app', 'chat-client'] } } })
    const session = { header: { id: 's1', cwd: 'D:\\workspace' } }
    ctx.service.handleSessionEvent(session, {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'reluctant 是什么意思' }] },
    })
    assert.equal(ctx.service.state.words.reluctant.source, 'auto')
    assert.equal(ctx.service.state.words.reluctant.srs.due, dayKey(ctx.service.now()))
    ctx.service.handleSessionEvent(session, {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'the ability 是什么意思' }] },
    })
    assert.equal(ctx.service.state.words.the, undefined, 'auto-capture skips function-word noise')
    assert.ok(ctx.service.state.words.ability)
    const before = Object.keys(ctx.service.state.words).length

    ctx.service.handleSessionEvent({ header: { id: 's2', cwd: 'C:\\workspace\\demo-project' } }, {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'ability 是什么意思' }] },
    })
    assert.equal(Object.keys(ctx.service.state.words).length, before)

    ctx.service.handleSessionEvent({ header: { id: 's3', origin: 'subagent' } }, {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'ability 是什么意思' }] },
    })
    assert.equal(Object.keys(ctx.service.state.words).length, before)

    ctx.service.handleSessionEvent(session, {
      type: 'user/message',
      data: { source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'ability 是什么意思' }] },
    })
    assert.equal(Object.keys(ctx.service.state.words).length, before)

    const longText = 'This long homework passage keeps talking about ability and reluctant and deadline and strategy. '.repeat(8)
    ctx.service.handleSessionEvent({ header: { id: 's4', cwd: 'D:\\workspace' } }, {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: longText }] },
    })
    assert.ok(ctx.service.inbox.items.length > 0, 'long text goes to candidates')
    assert.equal(ctx.service.state.words.deadline, undefined, 'long text does not auto-add')

    ctx.service.execute({ id: 'off-1', type: 'updateSettings', payload: { autoCapture: { enabled: false, excludeCwdPatterns: ['excluded-app', 'chat-client'] } } })
    const count = Object.keys(ctx.service.state.words).length
    ctx.service.handleSessionEvent(session, {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'meticulous 是什么意思' }] },
    })
    assert.equal(Object.keys(ctx.service.state.words).length, count)
  } finally {
    ctx.cleanup()
  }
})

test('auto words park after three untouched days and can be revived by grading', () => {
  const ctx = tempService()
  try {
    ctx.service.execute({ id: 'onboard-3', type: 'completeOnboarding', payload: { packs: { enabled: ['cet4'], primary: 'cet4' }, autoCapture: { enabled: true } } })
    ctx.service.addWord({ w: 'reluctant' }, { source: 'auto', auto: true })
    const entry = ctx.service.state.words.reluctant
    entry.addedAt = ctx.service.now().getTime() - 4 * 86400000
    ctx.service.parkStaleAuto()
    assert.equal(entry.autoState, 'parked')
    ctx.service.execute({ id: 'grade-parked', type: 'gradeWord', payload: { w: 'reluctant', result: 'good', retrieval: true, mode: 'en2cn' } })
    assert.equal(ctx.service.state.words.reluctant.autoState, 'active')
  } finally {
    ctx.cleanup()
  }
})

test('daily presets map light/standard/sprint/custom to daily caps', () => {
  const ctx = tempService()
  try {
    const cases = [
      ['light', 10, 2],
      ['standard', 25, 5],
      ['sprint', 50, 10],
    ]
    for (const [preset, reviewCap, autoCap] of cases) {
      const result = ctx.service.execute({ id: `preset-${preset}`, type: 'completeOnboarding', payload: { packs: { enabled: ['cet4'], primary: 'cet4' }, daily: { preset } } })
      assert.equal(result.ok, true)
      assert.equal(ctx.service.state.settings.daily.reviewCap, reviewCap)
      assert.equal(ctx.service.state.settings.daily.autoCap, autoCap)
      assert.equal(ctx.service.state.settings.autoCapture.dailyCap, autoCap)
    }
    const custom = ctx.service.execute({ id: 'preset-custom', type: 'completeOnboarding', payload: { packs: { enabled: ['cet4'], primary: 'cet4' }, daily: { preset: 'custom', reviewCap: 33, autoCap: 7 } } })
    assert.equal(custom.ok, true)
    assert.equal(ctx.service.state.settings.daily.reviewCap, 33)
    assert.equal(ctx.service.state.settings.daily.autoCap, 7)
  } finally {
    ctx.cleanup()
  }
})

test('partial settings updates preserve unrelated auto-capture fields', () => {
  const ctx = tempService()
  try {
    ctx.service.execute({ id: 'onboard-partial', type: 'completeOnboarding', payload: { packs: { enabled: ['cet4'], primary: 'cet4' }, autoCapture: { enabled: true, dailyCap: 9, excludeCwdPatterns: ['excluded-app', 'chat-client'] } } })
    const result = ctx.service.execute({ id: 'settings-partial', type: 'updateSettings', payload: { autoCapture: { enabled: false } } })
    assert.equal(result.ok, true)
    assert.equal(ctx.service.state.settings.autoCapture.enabled, false)
    assert.equal(ctx.service.state.settings.autoCapture.dailyCap, 9)
    assert.deepEqual(ctx.service.state.settings.autoCapture.excludeCwdPatterns, ['excluded-app', 'chat-client'])
  } finally {
    ctx.cleanup()
  }
})

test('importProgress clamps negative counters', () => {
  const ctx = tempService()
  try {
    const result = ctx.service.execute({
      id: 'import-negative',
      type: 'importProgress',
      payload: { words: { ability: { right: -5, wrong: -2, streak: -7, nextDue: '2026-11-18' } } },
    })
    assert.equal(result.ok, true)
    const srs = ctx.service.state.words.ability.srs
    assert.equal(srs.good, 0)
    assert.equal(srs.again, 0)
    assert.equal(srs.reps, 0)
    assert.equal(srs.due, '2026-11-18')
  } finally {
    ctx.cleanup()
  }
})

test('notes CRUD and candidate accept/clear work', () => {
  const ctx = tempService()
  try {
    const add = ctx.service.execute({ id: 'note-add', type: 'addNote', payload: { text: '第一次记录' } })
    assert.equal(add.ok, true)
    const note = ctx.service.state.notes[0]
    assert.equal(note.text, '第一次记录')
    const update = ctx.service.execute({ id: 'note-update', type: 'updateNote', payload: { id: note.id, text: '改过的记录' } })
    assert.equal(update.ok, true)
    assert.equal(ctx.service.state.notes[0].text, '改过的记录')
    const remove = ctx.service.execute({ id: 'note-delete', type: 'deleteNote', payload: { id: note.id } })
    assert.equal(remove.ok, true)
    assert.equal(ctx.service.state.notes.length, 0)

    ctx.service.execute({ id: 'onboard-candidate', type: 'completeOnboarding', payload: { packs: { enabled: ['cet4'], primary: 'cet4' }, autoCapture: { enabled: true } } })
    const longText = 'This passage mentions ability and strategy and deadline and compromise in a long homework paragraph. '.repeat(8)
    ctx.service.handleSessionEvent({ header: { id: 'candidate-session', cwd: 'D:\\workspace' } }, {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: longText }] },
    })
    assert.ok(ctx.service.inbox.items.length > 0)
    const candidate = ctx.service.inbox.items[0]
    const accepted = ctx.service.execute({ id: 'accept-candidate', type: 'acceptCandidate', payload: { id: candidate.id } })
    assert.equal(accepted.ok, true)
    assert.ok(ctx.service.state.words[candidate.w])
    const cleared = ctx.service.execute({ id: 'clear-auto', type: 'clearAutoCapture', payload: {} })
    assert.equal(cleared.ok, true)
    assert.equal(ctx.service.inbox.items.length, 0)
  } finally {
    ctx.cleanup()
  }
})

test('clearAutoCapture resets today auto cap and can be refilled', () => {
  const ctx = tempService()
  try {
    ctx.service.execute({ id: 'onboard-clear', type: 'completeOnboarding', payload: { packs: { enabled: ['cet4'], primary: 'cet4' }, autoCapture: { enabled: true } } })
    ctx.service.handleSessionEvent({ header: { id: 'clear-1', cwd: 'D:\\workspace' } }, {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'ability 是什么意思' }] },
    })
    ctx.service.execute({ id: 'clear-auto', type: 'clearAutoCapture', payload: {} })
    assert.equal(ctx.service.state.dayStats[dayKey(ctx.service.now())].autoAdded, 0)
    ctx.service.handleSessionEvent({ header: { id: 'clear-2', cwd: 'D:\\workspace' } }, {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'reluctant 是什么意思' }] },
    })
    assert.equal(ctx.service.state.words.reluctant.source, 'auto')
  } finally {
    ctx.cleanup()
  }
})

test('interval cap defaults to 60 days for long-term use and can be set to 14', () => {
  let srs = null
  for (let i = 0; i < 20; i++) srs = gradeSrs(srs, 'good', { retrieval: true, mode: 'en2cn', today: '2026-11-17' })
  assert.ok(srs.interval <= 60)
  let exam = null
  for (let i = 0; i < 20; i++) exam = gradeSrs(exam, 'good', { retrieval: true, mode: 'en2cn', today: '2026-11-17', maxIntervalDays: 14 })
  assert.ok(exam.interval <= 14)
  let narrow = null
  const intervals = []
  for (let i = 0; i < 3; i++) {
    narrow = gradeSrs(narrow, 'good', { retrieval: true, mode: 'en2cn', today: '2026-11-17', maxIntervalDays: 7 })
    intervals.push(narrow.interval)
  }
  assert.deepEqual(intervals, [1, 3, 7])
})

test('stale streak is shown as zero instead of the old count', () => {
  const ctx = tempService()
  try {
    ctx.service.state.streak = { days: 5, lastDay: addDays(ctx.service.today(), -5) }
    assert.equal(ctx.service.summary().streakDays, 0)
    ctx.service.state.streak = { days: 5, lastDay: addDays(ctx.service.today(), -1) }
    assert.equal(ctx.service.summary().streakDays, 5)
  } finally {
    ctx.cleanup()
  }
})

test('summary parks stale auto words without requiring a command', () => {
  const ctx = tempService()
  try {
    ctx.service.execute({ id: 'onboard-park', type: 'completeOnboarding', payload: { packs: { enabled: ['cet4'], primary: 'cet4' } } })
    ctx.service.addWord({ w: 'reluctant' }, { source: 'auto', auto: true })
    ctx.service.state.words.reluctant.addedAt = ctx.service.now().getTime() - 4 * 86400000
    const summary = ctx.service.summary()
    assert.equal(summary.dueCount, 0)
    assert.equal(ctx.service.state.words.reluctant.autoState, 'parked')
  } finally {
    ctx.cleanup()
  }
})

test('deleted words are not revived by an old candidate, and failed commands restore the inbox', () => {
  const ctx = tempService()
  try {
    ctx.service.execute({ id: 'cand-onboard', type: 'completeOnboarding', payload: { packs: { enabled: ['cet4', 'cet6'], primary: 'cet4' } } })
    const known = ctx.service.lookupWord('compromise')
    assert.ok(known)
    const day = ctx.service.today()
    assert.equal(ctx.service.addCandidate(known, 'old context', 's1', ['cet6']), true)
    ctx.service.execute({ id: 'cand-add', type: 'addWord', payload: { w: 'compromise' } })
    ctx.service.execute({ id: 'cand-delete', type: 'deleteWord', payload: { w: 'compromise' } })
    const accepted = ctx.service.execute({ id: 'cand-accept-old', type: 'acceptCandidate', payload: { id: `${day}:compromise` } })
    assert.equal(accepted.ok, true)
    assert.equal(accepted.result.skipped, 'dismissed')
    assert.equal(ctx.service.state.words.compromise, undefined)

    assert.equal(ctx.service.addCandidate(known, 'second', 's1', ['cet6']), true)
    const originalSave = ctx.service.saveState
    ctx.service.saveState = () => { throw new Error('disk full') }
    const failed = ctx.service.execute({ id: 'cand-fail', type: 'acceptCandidate', payload: { id: `${day}:compromise` } })
    ctx.service.saveState = originalSave
    assert.equal(failed.ok, false)
    assert.ok(ctx.service.inbox.items.some((item) => item.id === `${day}:compromise`), 'failed command must not lose the candidate')
  } finally {
    ctx.cleanup()
  }
})

test('daily review cap is enforced across repeated review rounds', () => {
  const ctx = tempService()
  try {
    ctx.service.execute({ id: 'cap-onboard', type: 'completeOnboarding', payload: { packs: { enabled: ['cet4'], primary: 'cet4' }, daily: { preset: 'custom', reviewCap: 2, autoCap: 0 } } })
    for (const w of ['ability', 'reluctant', 'strategy', 'deadline', 'compromise']) {
      ctx.service.execute({ id: `cap-add-${w}`, type: 'addWord', payload: { w } })
    }
    assert.equal(ctx.service.review('due', 25).length, 2)
    ctx.service.execute({ id: 'cap-grade-1', type: 'gradeWord', payload: { w: 'ability', result: 'good', retrieval: true, mode: 'en2cn' } })
    ctx.service.execute({ id: 'cap-grade-2', type: 'gradeWord', payload: { w: 'reluctant', result: 'good', retrieval: true, mode: 'en2cn' } })
    assert.equal(ctx.service.review('due', 25).length, 0)
    assert.equal(ctx.service.review('mastered', 10).length, 0)
  } finally {
    ctx.cleanup()
  }
})

test('malformed persisted SRS/day stats are sanitized instead of poisoning later grades', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-word-veil-sanitize-'))
  writeFileSync(join(dataDir, 'wordbook.json'), JSON.stringify({
    version: 1,
    revision: 1,
    settings: { onboardingDone: true, packs: { enabled: ['cet4'], primary: 'cet4' } },
    words: {
      ability: {
        w: 'ability',
        packs: ['cet4'],
        srs: { reps: 'bad', interval: 0, ef: 'bad', due: 'nope', good: -3, hard: 'x', again: null, lapses: 'x', retrievalGoodDays: ['bad', '2026-11-15'] },
        stats: { seen: 'x', graded: -1, lastSeenDay: 'bad' },
      },
    },
    dayStats: { [dayKey()]: { graded: 'x', good: -1, autoAdded: 'x' }, bad: 'x' },
    streak: { days: 'x', lastDay: 'bad' },
    dismissedWords: ['__proto__', 'ability'],
    recentCommandIds: [1, 'x'],
  }), 'utf8')
  const service = createService({ dataDir, logger: { warn() {}, error() {} } })
  try {
    const entry = service.state.words.ability
    assert.equal(entry.srs.reps, 0)
    assert.equal(entry.srs.interval, 1)
    assert.equal(entry.srs.ef, 2.5)
    assert.equal(entry.srs.due, dayKey(service.now()))
    assert.equal(entry.srs.good, 0)
    assert.deepEqual(entry.srs.retrievalGoodDays, ['2026-11-15'])
    assert.equal(entry.stats.graded, 0)
    assert.equal(service.state.streak.days, 0)
    assert.equal(service.state.dayStats[dayKey(service.now())].graded, 0)
    assert.equal(service.state.dayStats.bad, undefined)
    assert.equal(service.state.dismissedWords.includes('__proto__'), false)
    const graded = service.execute({ id: 'sanitized-grade', type: 'gradeWord', payload: { w: 'ability', result: 'good', retrieval: true, mode: 'cn2en' } })
    assert.equal(graded.ok, true)
    assert.equal(Number.isFinite(service.state.words.ability.srs.interval), true)
    assert.equal(Number.isFinite(service.state.words.ability.srs.ef), true)
  } finally {
    service.dispose()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('manual re-add revives a parked auto word', () => {
  const ctx = tempService()
  try {
    ctx.service.addWord({ w: 'reluctant' }, { source: 'auto', auto: true })
    ctx.service.state.words.reluctant.addedAt = ctx.service.now().getTime() - 4 * 86400000
    ctx.service.parkStaleAuto()
    assert.equal(ctx.service.state.words.reluctant.autoState, 'parked')
    ctx.service.execute({ id: 'revive', type: 'addWord', payload: { w: 'reluctant' } })
    assert.equal(ctx.service.state.words.reluctant.autoState, 'active')
    assert.equal(ctx.service.state.words.reluctant.auto, false, 'manual re-add makes it a manual word')
  } finally {
    ctx.cleanup()
  }
})

test('restores the newest backup when wordbook.json is corrupt', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-word-veil-restore-'))
  try {
    writeFileSync(join(dataDir, 'wordbook.json'), '{ broken', 'utf8')
    writeFileSync(join(dataDir, 'wordbook.json.bak-2020-01-01'), JSON.stringify({
      version: 1,
      revision: 4,
      settings: { onboardingDone: true, packs: { enabled: ['cet4'], primary: 'cet4' } },
      words: {
        ability: { w: 'ability', packs: ['cet4'], srs: { due: dayKey() }, stats: { seen: 1, graded: 0 } },
      },
      notes: [],
      dayStats: {},
      streak: { days: 0, lastDay: '' },
    }), 'utf8')
    const service = createService({ dataDir, logger: { warn() {}, error() {} } })
    try {
      assert.equal(service.corrupt, true)
      assert.equal(service.state.revision, 4)
      assert.ok(service.state.words.ability)
      assert.equal(service.summary().dueCount, 1)
      const restarted = createService({ dataDir, logger: { warn() {}, error() {} } })
      try {
        assert.ok(restarted.state.words.ability, 'restored wordbook must survive a restart')
        assert.equal(restarted.corrupt, false)
      } finally {
        restarted.dispose()
      }
    } finally {
      service.dispose()
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('restores inbox from its backup and preserves the corrupt original', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-word-veil-inbox-restore-'))
  try {
    writeFileSync(join(dataDir, 'inbox.json'), '{ broken', 'utf8')
    writeFileSync(join(dataDir, 'inbox.json.bak-2020-01-01'), JSON.stringify({
      version: 1,
      items: [{ id: 'x:ability', w: 'ability', packs: ['cet4'], context: 'ctx', day: '2020-01-01' }],
      byDay: { '2020-01-01': 1 },
    }), 'utf8')
    const service = createService({ dataDir, logger: { warn() {}, error() {} } })
    try {
      assert.equal(service.inbox.items.length, 1)
      assert.equal(service.inbox.items[0].w, 'ability')
      assert.ok(readdirSync(dataDir).some((name) => name.startsWith('inbox.json.corrupt.')))
    } finally {
      service.dispose()
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('updating the daily preset does not silently reset the separate auto-capture cap', () => {
  const ctx = tempService()
  try {
    ctx.service.execute({ id: 'caps-onboard', type: 'completeOnboarding', payload: { packs: { enabled: ['cet4'], primary: 'cet4' }, daily: { preset: 'standard' } } })
    ctx.service.execute({ id: 'caps-auto', type: 'updateSettings', payload: { autoCapture: { dailyCap: 9 } } })
    ctx.service.execute({ id: 'caps-daily', type: 'updateSettings', payload: { daily: { preset: 'light' } } })
    assert.equal(ctx.service.state.settings.daily.autoCap, 2)
    assert.equal(ctx.service.state.settings.autoCapture.dailyCap, 9)
  } finally {
    ctx.cleanup()
  }
})

test('master switch gates auto-capture and is persisted', () => {
  const ctx = tempService()
  try {
    ctx.service.execute({
      id: 'switch-off',
      type: 'completeOnboarding',
      payload: { packs: { enabled: ['cet4'], primary: 'cet4' }, autoCapture: { enabled: true }, enabled: false },
    })
    assert.equal(ctx.service.summary().enabled, false)
    ctx.service.handleSessionEvent({ header: { id: 'switch-1', cwd: 'D:\\workspace' } }, {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'ability 是什么意思' }] },
    })
    assert.equal(ctx.service.state.words.ability, undefined)
    const on = ctx.service.execute({ id: 'switch-on', type: 'updateSettings', payload: { enabled: true } })
    assert.equal(on.ok, true)
    assert.equal(ctx.service.summary().enabled, true)
    ctx.service.handleSessionEvent({ header: { id: 'switch-2', cwd: 'D:\\workspace' } }, {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'ability 是什么意思' }] },
    })
    assert.equal(ctx.service.state.words.ability.source, 'auto')
  } finally {
    ctx.cleanup()
  }
})

test('restoreBackup restores full SRS, notes and settings from an export payload', () => {
  const source = tempService()
  const target = tempService()
  try {
    source.service.execute({ id: 'backup-onboard', type: 'completeOnboarding', payload: { packs: { enabled: ['cet4'], primary: 'cet4' }, daily: { preset: 'sprint' } } })
    source.service.execute({ id: 'backup-add', type: 'addWord', payload: { w: 'ability' } })
    source.service.execute({ id: 'backup-grade', type: 'gradeWord', payload: { w: 'ability', result: 'good', retrieval: true, mode: 'cn2en' } })
    source.service.execute({ id: 'backup-note', type: 'addNote', payload: { text: 'restore me' } })
    const payload = source.service.stateSnapshot()
    const result = target.service.execute({ id: 'backup-restore', type: 'restoreBackup', payload })
    assert.equal(result.ok, true)
    assert.equal(result.result.restoredWords, 1)
    assert.equal(target.service.state.words.ability.srs.reps, 1)
    assert.deepEqual(target.service.state.words.ability.srs.productionGoodDays, [target.service.today()])
    assert.equal(target.service.state.notes[0].text, 'restore me')
    assert.equal(target.service.state.settings.daily.preset, 'sprint')
  } finally {
    source.cleanup()
    target.cleanup()
  }
})

test('invalid grade results are rejected instead of silently becoming again', () => {
  const ctx = tempService()
  try {
    ctx.service.execute({ id: 'bad-grade-onboard', type: 'completeOnboarding', payload: { packs: { enabled: ['cet4'], primary: 'cet4' } } })
    ctx.service.execute({ id: 'bad-grade-add', type: 'addWord', payload: { w: 'ability' } })
    const result = ctx.service.execute({ id: 'bad-grade', type: 'gradeWord', payload: { w: 'ability', result: 'excellent' } })
    assert.equal(result.ok, false)
    assert.equal(ctx.service.state.words.ability.srs.reps, 0)
  } finally {
    ctx.cleanup()
  }
})

test('rejects prototype-pollution word keys', () => {
  const ctx = tempService()
  try {
    for (const type of ['updateWord', 'gradeWord', 'deleteWord']) {
      const result = ctx.service.execute({ id: `proto-${type}`, type, payload: { w: '__proto__', note: 'polluted', result: 'good' } })
      assert.equal(result.ok, false, `${type} rejects __proto__`)
    }
    assert.equal(Object.prototype.note, undefined)
  } finally {
    ctx.cleanup()
  }
})

test('import does not overwrite an already graded word; delete adds a dismissal', () => {
  const ctx = tempService()
  try {
    ctx.service.execute({ id: 'add-keep', type: 'addWord', payload: { w: 'ability' } })
    ctx.service.execute({ id: 'grade-keep', type: 'gradeWord', payload: { w: 'ability', result: 'good', retrieval: true, mode: 'cn2en' } })
    const before = ctx.service.state.words.ability.srs.reps
    const imported = ctx.service.execute({ id: 'import-keep', type: 'importProgress', payload: { words: { ability: { right: 0, wrong: 5, nextDue: '2026-11-18' } } } })
    assert.equal(imported.ok, true)
    assert.equal(imported.result.imported, 0)
    assert.equal(imported.result.skipped, 1)
    assert.equal(ctx.service.state.words.ability.srs.reps, before)
    ctx.service.execute({ id: 'delete-keep', type: 'deleteWord', payload: { w: 'ability' } })
    assert.equal(ctx.service.state.words.ability, undefined)
    assert.equal(ctx.service.state.dismissedWords.includes('ability'), true)
    ctx.service.execute({ id: 'readd-keep', type: 'addWord', payload: { w: 'ability' } })
    assert.equal(ctx.service.state.words.ability !== undefined, true)
    assert.equal(ctx.service.state.dismissedWords.includes('ability'), false, 'explicit re-add clears the dismissal')
  } finally {
    ctx.cleanup()
  }
})

test('importProgress maps the existing progress shape', () => {
  const ctx = tempService()
  try {
    const result = ctx.service.execute({
      id: 'import-1',
      type: 'importProgress',
      payload: { words: { ability: { served: 2, right: 1, wrong: 1, last: '2026-11-16', streak: 1, nextDue: '2026-11-18' } } },
    })
    assert.equal(result.ok, true)
    assert.equal(result.result.imported, 1)
    const entry = ctx.service.state.words.ability
    assert.equal(entry.source, 'import')
    assert.equal(entry.srs.due, '2026-11-18')
    assert.equal(entry.srs.good, 1)
    assert.equal(entry.srs.again, 1)
  } finally {
    ctx.cleanup()
  }
})
