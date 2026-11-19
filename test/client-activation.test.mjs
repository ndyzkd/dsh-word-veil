import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CLIENT = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')

function fakeReact() {
  return {
    createElement: (...args) => ({ args }),
    Fragment: 'Fragment',
    useState: (value) => [value, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
}

function loadClient() {
  let spec = null
  const localStorage = {
    data: new Map(),
    getItem(key) { return this.data.has(key) ? this.data.get(key) : null },
    setItem(key, value) { this.data.set(key, String(value)) },
    removeItem(key) { this.data.delete(key) },
  }
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { spec = value } } },
    console,
    localStorage,
    __CWB_FIXTURE__: true,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  }
  vm.runInNewContext(CLIENT, sandbox, { filename: 'lib/client.js' })
  assert.ok(spec, 'client registered a ModuleLoader spec')
  const exports = spec.factory((name) => {
    if (name === 'react') return fakeReact()
    throw new Error(`unexpected require: ${name}`)
  })
  return { spec, exports, sandbox }
}

function fakeCtx() {
  const registrations = []
  const ctx = {
    effect() { return () => {} },
    locale: {
      register() { return () => {} },
      bind() { return (key) => key },
    },
    slots: {
      inject(owner, callback) {
        if (owner === 'main' || owner === 'sidebar.panellist' || owner === 'conversation.session.header.actions') callback()
        return () => {}
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
    layout: {
      panelInfo: {
        subscribe() { return () => {} },
        getSnapshot() { return { activePanelId: null } },
      },
    },
    inject() {},
  }
  return { ctx, registrations }
}

test('client factory exports inject/apply and registers the left panel + icon', () => {
  const { spec, exports } = loadClient()
  assert.equal(spec.id, 'dsh-word-veil')
  assert.deepEqual(Array.from(exports.inject), ['slots', 'locale', 'layout'])
  assert.equal(typeof exports.apply, 'function')
  const { ctx, registrations } = fakeCtx()
  assert.doesNotThrow(() => exports.apply(ctx))
  const main = registrations.find((entry) => entry.options.name === 'main')
  assert.ok(main, 'main panel registered')
  assert.equal(main.options.key, 'dsh-word-veil')
  const sidebar = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
  assert.ok(sidebar, 'sidebar icon registered')
  assert.equal(sidebar.options.id, 'dsh-word-veil')
  assert.equal(sidebar.options.order, 20)
  assert.equal(sidebar.options.label(), 'panel')
  assert.equal(typeof sidebar.component, 'function')
  const header = registrations.find((entry) => entry.options.name === 'conversation.session.header.actions')
  assert.ok(header, 'conversation header veil control registered')
  assert.equal(header.options.id, 'word-veil-conversation-veil')
  assert.equal(header.options.order, 100)
  assert.equal(typeof header.component, 'function')
})

test('Chinese index turns exam meanings into display words and skips stopwords', () => {
  const { exports, sandbox } = loadClient()
  const { ctx } = fakeCtx()
  exports.apply(ctx)
  const { buildChineseIndex, transformChineseText } = sandbox.__CWB_TEST__
  assert.ok(buildChineseIndex && transformChineseText)
  const packData = {
    cet4: {
      words: [
        { w: 'ability', ph: 'əˈbɪləti', pos: 'n.', cn: 'n. 能力, 才干', rank: 10 },
        { w: 'basic', ph: 'ˈbeɪsɪk', pos: 'adj.', cn: 'adj. 基础, 基本的', rank: 20 },
      ],
    },
  }
  const index = buildChineseIndex(packData, ['cet4'])
  const segments = transformChineseText('能力是基础，一个都不能少。', index)
  assert.equal(segments.some((segment) => segment.type === 'word' && segment.text === 'ability'), true)
  assert.equal(segments.some((segment) => segment.type === 'text' && segment.text.includes('一个')), true)
  assert.equal(segments.filter((segment) => segment.type === 'word').length, 2)
})

test('wordHeat maps error frequency to readable heat bands', () => {
  const { exports, sandbox } = loadClient()
  exports.apply(fakeCtx().ctx)
  const { wordHeat } = sandbox.__CWB_TEST__
  assert.ok(wordHeat)
  assert.equal(wordHeat(null).level, 'new')
  assert.equal(wordHeat({ srs: { good: 0, hard: 0, again: 0 } }).level, 'collected')
  assert.equal(wordHeat({ srs: { good: 0, hard: 0, again: 0 } }).color, 'var(--cwb-heat-collected)')
  assert.equal(wordHeat({ srs: { good: 0, hard: 1, again: 0, lastGrade: 'hard' } }).level, 'watch')
  assert.equal(wordHeat({ srs: { good: 10, hard: 0, again: 0, lapses: 3, reps: 3, lastGrade: 'good', retrievalGoodDays: ['a', 'b'], productionGoodDays: ['b'] } }).level, 'mastered')
  assert.equal(wordHeat({ srs: { good: 8, hard: 0, again: 2, lapses: 0 } }).level, 'watch')
  assert.equal(wordHeat({ srs: { good: 8, hard: 0, again: 2, lapses: 0 } }).color, 'var(--cwb-heat-watch)')
  assert.equal(wordHeat({ srs: { good: 7, hard: 0, again: 3, lapses: 0 } }).level, 'warm')
  assert.equal(wordHeat({ srs: { good: 5, hard: 0, again: 5, lapses: 0 } }).level, 'hot')
  assert.equal(wordHeat({ srs: { good: 10, hard: 0, again: 0, reps: 3, lastGrade: 'good', retrievalGoodDays: ['a', 'b'], productionGoodDays: ['b'] } }).level, 'mastered')
  assert.equal(wordHeat({ srs: { good: 2, hard: 0, again: 0, reps: 1 } }).level, 'stable')
})

test('conversation meta is compact and exam-aware', () => {
  const { exports, sandbox } = loadClient()
  exports.apply(fakeCtx().ctx)
  const { formatConversationMeta, dayKey } = sandbox.__CWB_TEST__
  const t = (key) => sandbox.__CWB_TEST__.DICTS.zh[key] ?? key
  const future = new Date()
  future.setDate(future.getDate() + 23)
  const examDate = dayKey(future)
  const snapshot = {
    state: { settings: { daily: { reviewCap: 25 }, examDates: [{ name: '四级', date: examDate }] } },
    summary: { todayGraded: 3, dueCount: 12 },
  }
  const meta = formatConversationMeta(snapshot, t)
  assert.match(meta, /今日 3\/25/)
  assert.match(meta, /待复习 12/)
  assert.ok(meta.includes(`四级 ${examDate.slice(5)}`))
  assert.match(meta, /23天/)
  const noReview = formatConversationMeta({ state: { settings: { daily: { reviewCap: 25 }, examDates: [] } }, summary: { todayGraded: 0, dueCount: 0 } }, t)
  assert.match(noReview, /今日未复习/)
  assert.doesNotMatch(noReview, /考试/)
})

test('per-conversation veil override falls back to the global switch', () => {
  const { exports, sandbox } = loadClient()
  exports.apply(fakeCtx().ctx)
  const { conversationVeilEnabled, setConversationVeilOverride, clearConversationVeilOverride, conversationVeilOverrides } = sandbox.__CWB_TEST__
  const snapshot = { state: { settings: { enabled: true } } }
  assert.equal(conversationVeilEnabled('session-a', snapshot), true)
  setConversationVeilOverride('session-a', false)
  assert.equal(conversationVeilEnabled('session-a', snapshot), false)
  assert.equal(conversationVeilEnabled('session-b', snapshot), true)
  clearConversationVeilOverride('session-a')
  assert.equal(conversationVeilEnabled('session-a', snapshot), true)
  assert.equal(typeof conversationVeilOverrides.get, 'function')
  const off = { state: { settings: { enabled: false } } }
  setConversationVeilOverride('session-c', true)
  assert.equal(conversationVeilEnabled('session-c', off), true)
  clearConversationVeilOverride('session-c')
})

test('pending dot follows due/new, acted, opened and disabled states', () => {
  const { exports, sandbox } = loadClient()
  const { ctx } = fakeCtx()
  exports.apply(ctx)
  const { app, badge } = sandbox.__CWB_TEST__ ?? {}
  assert.ok(app && badge, 'fixture exposes app and badge')
  app.update({ state: { settings: { enabled: true, badge: { enabled: true } } }, summary: { dueCount: 0, newAutoCount: 0, actedToday: false } })
  badge.openedDay = ''
  badge.compute()
  assert.equal(badge.getSnapshot().on, true, 'first open of the day lights the dot')
  assert.equal(badge.getSnapshot().reason, 'daily')

  badge.markOpened()
  assert.equal(badge.getSnapshot().on, false, 'opening clears the daily dot')

  app.update({ state: { settings: { enabled: true, badge: { enabled: true } } }, summary: { dueCount: 2, newAutoCount: 0, actedToday: false } })
  assert.equal(badge.getSnapshot().on, true, 'pending reviews light the dot')
  assert.equal(badge.getSnapshot().reason, 'pending')

  app.update({ state: { settings: { enabled: true, badge: { enabled: true } } }, summary: { dueCount: 2, newAutoCount: 0, actedToday: true } })
  assert.equal(badge.getSnapshot().on, false, 'one real retrieval clears the dot for the day')

  app.update({ state: { settings: { enabled: true, badge: { enabled: false } } }, summary: { dueCount: 2, newAutoCount: 1, actedToday: false } })
  assert.equal(badge.getSnapshot().on, false, 'disabled badge stays off')

  app.update({ state: { settings: { enabled: false, badge: { enabled: true } } }, summary: { dueCount: 2, newAutoCount: 1, actedToday: false } })
  assert.equal(badge.getSnapshot().on, false, 'disabled plugin stays off')

  badge.preview()
  assert.equal(badge.getSnapshot().on, true, 'preview forces the dot on')
})
