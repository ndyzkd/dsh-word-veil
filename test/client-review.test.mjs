import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { createRouteHandler, createService } from '../src/host.js'

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

function loadClient(fetchImpl) {
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
    fetch: fetchImpl ?? globalThis.fetch,
  }
  vm.runInNewContext(CLIENT, sandbox, { filename: 'lib/client.js' })
  const exports = spec.factory((name) => {
    if (name === 'react') return fakeReact()
    throw new Error(`unexpected require: ${name}`)
  })
  return { spec, exports, sandbox }
}

function fakeCtx() {
  const ctx = {
    effect() { return () => {} },
    locale: { register() { return () => {} }, bind() { return (key) => key } },
    slots: { inject() { return () => {} }, register() { return () => {} } },
    layout: { panelInfo: { subscribe() { return () => {} }, getSnapshot() { return { activePanelId: null } } } },
    inject() {},
  }
  return ctx
}

test('question builder produces unique en→cn options and strict production checks', () => {
  const { exports, sandbox } = loadClient()
  exports.apply(fakeCtx())
  const { buildQuestion, isProductionCorrect, meaningOf } = sandbox.__CWB_TEST__
  const target = { w: 'ability', ph: 'əˈbiliti', pos: 'n.', sense: 'n. 能力, 才干', cn: '' }
  const pool = [
    target,
    { w: 'reluctant', pos: 'adj.', sense: 'a. 不情愿的' },
    { w: 'strategy', pos: 'n.', sense: 'n. 策略' },
    { w: 'deadline', pos: 'n.', sense: 'n. 最后期限' },
    { w: 'compromise', pos: 'n.', sense: 'n. 妥协' },
  ]
  const q = buildQuestion(target, pool, 'en2cn', () => 0.42)
  assert.equal(q.prompt, 'ability')
  assert.equal(q.options.length, 4)
  assert.equal(q.options.filter((option) => option.correct).length, 1)
  assert.equal(new Set(q.options.map((option) => option.label)).size, 4)
  const production = buildQuestion(target, pool, 'cn2en')
  assert.equal(production.answer, 'ability')
  assert.equal(production.prompt, '能力, 才干')
  assert.match(production.hint, /a.*7/)
  assert.equal(isProductionCorrect(' Ability ', target), true)
  assert.equal(isProductionCorrect('able', target), false)
  assert.equal(meaningOf(target), '能力, 才干')
})

test('client start survives an unavailable Host instead of rejecting forever', async () => {
  const { exports, sandbox } = loadClient(async () => { throw new Error('host offline') })
  exports.apply(fakeCtx())
  const { app } = sandbox.__CWB_TEST__
  await assert.doesNotReject(() => app.start())
  assert.equal(app.getSnapshot().connected, false)
  assert.match(app.getSnapshot().error, /host offline/)
  app.dispose()
})

test('client boot and commands work against the real local Host routes', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-word-veil-client-'))
  const service = createService({ dataDir, logger: { warn() {}, error() {} } })
  const server = createServer(createRouteHandler(service))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  let clientApp
  try {
    const { exports, sandbox } = loadClient((url, init) => globalThis.fetch(`${base}${url}`, init))
    exports.apply(fakeCtx())
    const { app, badge } = sandbox.__CWB_TEST__
    clientApp = app
    await app.start()
    let snapshot = app.getSnapshot()
    assert.equal(snapshot.connected, true)
    assert.equal(snapshot.state.settings.onboardingDone, false)
    assert.equal(snapshot.packs.length, 7)

    await app.send('completeOnboarding', { packs: { enabled: ['cet4'], primary: 'cet4' }, daily: { preset: 'standard' } })
    snapshot = app.getSnapshot()
    assert.equal(snapshot.state.settings.onboardingDone, true)
    assert.equal(snapshot.state.settings.enabled, true)
    assert.equal(snapshot.state.settings.daily.reviewCap, 25)
    assert.ok(snapshot.packData.cet4, 'primary pack data loaded')

    await app.send('updateSettings', { enabled: false })
    assert.equal(app.getSnapshot().summary.enabled, false)
    assert.equal(badge.getSnapshot().on, false, 'master switch turns the dot off')
    await app.send('updateSettings', { enabled: true })
    await app.send('updateSettings', { packs: { enabled: ['cet6'], primary: 'cet6' } })
    snapshot = app.getSnapshot()
    assert.equal(snapshot.state.settings.packs.primary, 'cet6')
    assert.ok(snapshot.packData.cet6, 'switched pack data loaded')
    await app.send('updateSettings', { packs: { enabled: ['cet4'], primary: 'cet4' } })

    await app.send('addWord', { w: 'ability' })
    await app.send('gradeWord', { w: 'ability', result: 'good', retrieval: true, mode: 'cn2en' })
    snapshot = app.getSnapshot()
    assert.equal(snapshot.state.words.ability.srs.reps, 1)
    assert.equal(snapshot.summary.actedToday, true)
    assert.equal(snapshot.summary.todayGraded, 1)
    assert.equal(badge.getSnapshot().on, false, 'one retrieval clears the dot for the day')
  } finally {
    clientApp?.dispose()
    await new Promise((resolve) => server.close(resolve))
    service.dispose()
    rmSync(dataDir, { recursive: true, force: true })
  }
})
