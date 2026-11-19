import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRouteHandler, createService } from '../src/host.js'

async function withServer(fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-word-veil-route-'))
  const service = createService({ dataDir, logger: { warn() {}, error() {} } })
  const server = createServer(createRouteHandler(service))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await fn({ base: `http://127.0.0.1:${port}/dsh-word-veil`, service })
  } finally {
    await new Promise((resolve) => server.close(resolve))
    service.dispose()
    rmSync(dataDir, { recursive: true, force: true })
  }
}

test('routes expose state, summary, packs, pack data and status', async () => {
  await withServer(async ({ base }) => {
    const state = await fetch(`${base}/state`).then((r) => r.json())
    assert.equal(state.ok, true)
    assert.equal(state.state.settings.onboardingDone, false)
    assert.equal(state.summary.dueCount, 0)
    const summary = await fetch(`${base}/summary`).then((r) => r.json())
    assert.equal(summary.summary.wordCount, 0)
    const packs = await fetch(`${base}/packs`).then((r) => r.json())
    assert.deepEqual(packs.packs.map((pack) => pack.id), ['primary', 'ket', 'pet', 'gaokao', 'cet4', 'cet6', 'kaoyan'])
    const cet4 = await fetch(`${base}/packs/cet4`).then((r) => r.json())
    assert.equal(cet4.pack.id, 'cet4')
    assert.ok(cet4.pack.words.length > 3000)
    const status = await fetch(`${base}/status`).then((r) => r.json())
    assert.equal(status.ok, true)
    assert.equal(typeof status.status.wordbookBytes, 'number')
    assert.equal(status.status.dataDir, undefined)
  })
})

test('commands are accepted and review returns due targets', async () => {
  await withServer(async ({ base }) => {
    const onboard = await fetch(`${base}/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'onboard', type: 'completeOnboarding', payload: { packs: { enabled: ['cet4'], primary: 'cet4' }, daily: { preset: 'standard' } } }),
    }).then((r) => r.json())
    assert.equal(onboard.ok, true)
    const added = await fetch(`${base}/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'add-ability', type: 'addWord', payload: { w: 'ability' } }),
    }).then((r) => r.json())
    assert.equal(added.ok, true)
    const review = await fetch(`${base}/review?scope=due&limit=5`).then((r) => r.json())
    assert.equal(review.ok, true)
    assert.equal(review.targets.some((target) => target.w === 'ability'), true)
    const inbox = await fetch(`${base}/inbox`).then((r) => r.json())
    assert.equal(inbox.ok, true)
  })
})

test('oversized command bodies are rejected with 413, not a dropped socket', async () => {
  await withServer(async ({ base }) => {
    const body = 'x'.repeat(5 * 1024 * 1024 + 1)
    const response = await fetch(`${base}/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    assert.equal(response.status, 413)
    const payload = await response.json()
    assert.equal(payload.ok, false)
  })
})

test('bad JSON and unknown paths fail safely', async () => {
  await withServer(async ({ base }) => {
    const bad = await fetch(`${base}/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{oops',
    })
    assert.equal(bad.status, 400)
    const missing = await fetch(`${base}/nope`)
    assert.equal(missing.status, 404)
    const missingPack = await fetch(`${base}/packs/nope`)
    assert.equal(missingPack.status, 404)
    const malformedPack = await fetch(`${base}/packs/%E0%A4%A`)
    assert.equal(malformedPack.status, 400)
  })
})
