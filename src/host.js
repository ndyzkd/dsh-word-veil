/**
 * Host half of dsh-word-veil.
 *
 * The wordbook is the single source of truth: SRS state, notes, auto-capture
 * candidates, and the pack word maps all live behind one serial command queue.
 * The browser is a thin view that sends commands and renders snapshots.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PACKS_DIR = join(ROOT, 'packs')
const PREFIX = '/dsh-word-veil'
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isValidDay(value) {
  const match = DAY_RE.exec(String(value ?? ''))
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
const WORD_RE = /^[a-z][a-z'-]*$/
const MAX_BODY = 5 * 1024 * 1024
const MAX_WORDS = 20000
const MAX_NOTES = 500
const MAX_DISMISSED = 500
const MAX_RECENT_COMMANDS = 500
const PRESETS = {
  light: { reviewCap: 10, autoCap: 2 },
  standard: { reviewCap: 25, autoCap: 5 },
  sprint: { reviewCap: 50, autoCap: 10 },
}

/** Local calendar day key (YYYY-MM-DD). */
export function dayKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Add days to a day key without crossing time zones. */
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d + n)
  return dayKey(date)
}

/** Whole-day difference b - a. */
export function dayDiff(a, b) {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isInteger(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** Default SRS state for a word that has never been graded. */
export function defaultSrs(due) {
  return {
    ef: 2.5,
    reps: 0,
    interval: 0,
    due,
    lastGrade: null,
    lastAt: 0,
    lastRecheck: '',
    lapses: 0,
    good: 0,
    hard: 0,
    again: 0,
    wrongStreak: 0,
    retrievalGoodDays: [],
    productionGoodDays: [],
  }
}

/** Apply one grade to an SRS record. Pure: returns a new object. */
export function gradeSrs(input, result, { retrieval = false, mode = 'en2cn', today, maxIntervalDays = 60 } = {}) {
  const baseDay = isValidDay(today) ? today : dayKey()
  const srs = { ...defaultSrs(baseDay), ...(input ?? {}) }
  const cap = Math.max(1, Math.min(365, Number(maxIntervalDays) || 60))
  srs.reps = Math.max(0, Math.min(10000, Number(srs.reps) || 0))
  srs.interval = Math.max(1, Math.min(365, Number(srs.interval) || 1))
  srs.ef = Math.max(1.3, Math.min(2.8, Number(srs.ef) || 2.5))
  srs.good = Math.max(0, Number(srs.good) || 0)
  srs.hard = Math.max(0, Number(srs.hard) || 0)
  srs.again = Math.max(0, Number(srs.again) || 0)
  srs.lapses = Math.max(0, Number(srs.lapses) || 0)
  srs.wrongStreak = Math.max(0, Number(srs.wrongStreak) || 0)
  srs.retrievalGoodDays = Array.isArray(srs.retrievalGoodDays) ? srs.retrievalGoodDays.filter((day) => isValidDay(day)) : []
  srs.productionGoodDays = Array.isArray(srs.productionGoodDays) ? srs.productionGoodDays.filter((day) => isValidDay(day)) : []
  srs.retrievalGoodDays = [...new Set(srs.retrievalGoodDays)]
  srs.productionGoodDays = [...new Set(srs.productionGoodDays)]
  if (!['good', 'hard', 'again'].includes(result)) result = 'again'

  if (result === 'good') {
    srs.reps = (srs.reps || 0) + 1
    if (srs.reps === 1) srs.interval = Math.min(cap, 1)
    else if (srs.reps === 2) srs.interval = Math.min(cap, 3)
    else if (srs.reps === 3) srs.interval = Math.min(cap, 8)
    else srs.interval = Math.min(cap, Math.round((srs.interval || 1) * srs.ef))
    srs.ef = Math.min(2.8, (srs.ef || 2.5) + 0.1)
    srs.good += 1
    srs.wrongStreak = 0
    if (retrieval) {
      srs.retrievalGoodDays.push(baseDay)
      srs.retrievalGoodDays = [...new Set(srs.retrievalGoodDays)].slice(-60)
      if (['cn2en', 'cloze', 'spell'].includes(mode)) {
        srs.productionGoodDays.push(baseDay)
        srs.productionGoodDays = [...new Set(srs.productionGoodDays)].slice(-60)
      }
      srs.lastRecheck = baseDay
    }
  } else if (result === 'hard') {
    srs.ef = Math.max(1.3, (srs.ef || 2.5) - 0.1)
    srs.interval = Math.max(1, Math.min(cap, Math.round((srs.interval || 1) * 0.6)))
    srs.reps = Math.max(1, srs.reps || 0)
    srs.hard += 1
    srs.wrongStreak = 0
    if (retrieval) srs.lastRecheck = baseDay
  } else {
    srs.ef = Math.max(1.3, (srs.ef || 2.5) - 0.2)
    srs.reps = 0
    srs.interval = 1
    srs.again += 1
    srs.lapses = (srs.lapses || 0) + 1
    srs.wrongStreak = (srs.wrongStreak || 0) + 1
  }
  srs.lastGrade = result
  srs.lastAt = Date.now()
  srs.due = addDays(baseDay, srs.interval || 1)
  return srs
}

/** 0–5 familiarity score used by colors and the UI. */
export function strengthOf(srs) {
  if (!srs) return 0
  const value = (srs.reps || 0) + ((srs.ef || 2.5) >= 2.7 ? 1 : 0) - Math.floor((srs.lapses || 0) / 2)
  return Math.max(0, Math.min(5, Math.round(value)))
}

export function isFamiliar(srs) {
  return !!srs && (srs.reps || 0) >= 3 && srs.lastGrade === 'good'
}

export function isStubborn(srs) {
  if (!srs) return false
  const total = (srs.good || 0) + (srs.hard || 0) + (srs.again || 0)
  return (srs.wrongStreak || 0) >= 2 || ((srs.again || 0) >= 3 && total > 0 && (srs.again / total) >= 0.5)
}

export function isMastered(srs) {
  return isFamiliar(srs)
    && new Set(srs.retrievalGoodDays ?? []).size >= 2
    && new Set(srs.productionGoodDays ?? []).size >= 1
    && !isStubborn(srs)
}

/** Strip code, URLs, paths and markdown links from a user message. */
export function cleanUserText(value) {
  return String(value ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' ')
    .replace(/[A-Za-z]:\\[^\s，。；,;]+/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .split(/\r?\n/)
    .filter((line) => !/^\s*(const|let|var|function|class|import|export|def|return|if\s*\(|for\s*\(|while\s*\(|#include|public\s|private\s|<\/?[a-z]+)/i.test(line))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Every plausible English token with its source index. */
export function tokensOf(text) {
  const out = []
  const re = /[A-Za-z][A-Za-z'-]{2,}/g
  for (const match of String(text ?? '').matchAll(re)) {
    out.push({ raw: match[0], word: match[0].toLowerCase(), index: match.index ?? 0 })
  }
  return out
}

const LOOKUP_RE = /(什么意思|意思|怎么读|发音|翻译|英文|单词|词义|怎么说|怎么用)/
const AUTO_STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'with', 'this', 'that', 'from', 'have', 'has', 'was', 'were',
  'will', 'would', 'can', 'could', 'should', 'they', 'them', 'their', 'there', 'what', 'when', 'where', 'which', 'who',
  'how', 'all', 'any', 'one', 'two', 'use', 'make', 'get', 'got', 'just', 'like', 'more', 'most', 'some', 'such', 'than',
  'then', 'into', 'over', 'also', 'because', 'about', 'after', 'before', 'between', 'during', 'through', 'under', 'while',
  'these', 'those', 'our', 'out', 'off', 'its', 'his', 'her', 'him', 'she', 'yes', 'very', 'much', 'many', 'only', 'even',
])

function sentenceAround(text, index, length) {
  const start = Math.max(0, text.lastIndexOf('。', index) + 1, text.lastIndexOf('！', index) + 1, text.lastIndexOf('？', index) + 1, text.lastIndexOf('.', index) + 1, text.lastIndexOf('\n', index) + 1)
  const ends = [text.indexOf('。', index + length), text.indexOf('！', index + length), text.indexOf('？', index + length), text.indexOf('.', index + length), text.indexOf('\n', index + length)].filter((n) => n >= 0)
  const end = ends.length > 0 ? Math.min(...ends) + 1 : text.length
  return text.slice(start, end).trim().slice(0, 200)
}

function isCapitalizedNonSentence(text, token) {
  if (!/^[A-Z]/.test(token.raw)) return false
  const before = text.slice(0, token.index).trimEnd()
  if (before === '') return false
  return !'.!?。！？\n'.includes(before[before.length - 1])
}

function scoreToken(token, text, wordEntry) {
  let score = wordEntry.rank >= 1500 ? 2 : 1
  if (text.length <= 240) score += 1
  const window = text.slice(Math.max(0, token.index - 30), token.index + token.raw.length + 30)
  if (LOOKUP_RE.test(window)) score += 2
  return score
}

function normalizeSettings(raw, packIds) {
  const base = {
    enabled: false,
    onboardingDone: false,
    packs: { enabled: ['cet4'], primary: 'cet4' },
    daily: { preset: 'standard', reviewCap: 25, autoCap: 5 },
    srs: { maxIntervalDays: 60 },
    examDates: [],
    autoCapture: { enabled: false, maxPerMessage: 3, dailyCap: 5, excludeCwdPatterns: [] },
    badge: { enabled: true },
  }
  const settings = { ...base, ...(raw ?? {}) }
  const explicitEnabled = typeof raw?.enabled === 'boolean' ? raw.enabled : undefined
  const valid = new Set(packIds)
  const fallbackPack = packIds.values().next().value
  const enabled = Array.isArray(settings.packs?.enabled) ? settings.packs.enabled.filter((id) => valid.has(id)) : []
  settings.packs = {
    enabled: enabled.length > 0 ? [...new Set(enabled)] : (fallbackPack ? [fallbackPack] : []),
    primary: valid.has(settings.packs?.primary) ? settings.packs.primary : (enabled[0] ?? fallbackPack ?? ''),
  }
  if (!settings.packs.enabled.includes(settings.packs.primary)) settings.packs.primary = settings.packs.enabled[0] ?? ''
  const preset = ['light', 'standard', 'sprint', 'custom'].includes(settings.daily?.preset) ? settings.daily.preset : 'standard'
  const caps = PRESETS[preset] ?? PRESETS.standard
  settings.daily = {
    preset,
    reviewCap: preset === 'custom'
      ? clampInt(settings.daily?.reviewCap, 25, 1, 200)
      : caps.reviewCap,
    autoCap: preset === 'custom'
      ? clampInt(settings.daily?.autoCap, 5, 0, 50)
      : caps.autoCap,
  }
  settings.examDates = Array.isArray(settings.examDates)
    ? settings.examDates.filter((item) => item && typeof item.name === 'string' && isValidDay(item.date)).slice(0, 20)
    : []
  settings.srs = { maxIntervalDays: clampInt(settings.srs?.maxIntervalDays, 60, 7, 365) }
  settings.autoCapture = {
    enabled: settings.autoCapture?.enabled === true,
    maxPerMessage: clampInt(settings.autoCapture?.maxPerMessage, 3, 1, 10),
    dailyCap: clampInt(settings.autoCapture?.dailyCap, 5, 0, 50),
    excludeCwdPatterns: Array.isArray(settings.autoCapture?.excludeCwdPatterns)
      ? settings.autoCapture.excludeCwdPatterns.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()).slice(0, 20)
      : [],
  }
  settings.badge = { enabled: settings.badge?.enabled !== false }
  settings.onboardingDone = settings.onboardingDone === true
  settings.enabled = explicitEnabled ?? settings.onboardingDone
  return settings
}

function loadPacks(packsDir) {
  const indexPath = join(packsDir, 'index.json')
  if (!existsSync(indexPath)) throw new Error(`missing pack index: ${indexPath}`)
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  if (!Array.isArray(index) || index.length === 0) throw new Error('packs/index.json is empty')
  const packs = new Map()
  const allWords = new Map()
  const warnings = []
  for (const meta of index) {
    try {
      if (!meta || typeof meta.id !== 'string' || typeof meta.file !== 'string' || basename(meta.file) !== meta.file) throw new Error('bad metadata')
      const data = JSON.parse(readFileSync(join(packsDir, meta.file), 'utf8'))
      if (data.schema !== 1 || data.id !== meta.id || !Array.isArray(data.words) || !Array.isArray(data.core)) throw new Error('bad pack schema')
      const core = new Set(data.core)
      const pack = { meta, data, core }
      packs.set(meta.id, pack)
      for (const word of data.words) {
        if (!word || typeof word.w !== 'string' || !word.w) continue
        const key = word.w.toLowerCase()
        if (!allWords.has(key)) allWords.set(key, { ...word, w: key, packs: [] })
        allWords.get(key).packs.push(meta.id)
      }
    } catch (error) {
      warnings.push(`${meta?.id ?? 'unknown'}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (packs.size === 0) throw new Error(`no valid packs: ${warnings.join('; ')}`)
  return { index, packs, allWords, warnings }
}

function emptyState(settings) {
  return {
    version: 1,
    revision: 0,
    settings,
    words: {},
    notes: [],
    dayStats: {},
    streak: { days: 0, lastDay: '' },
    dismissedWords: [],
    recentCommandIds: [],
    updatedAt: 0,
  }
}

function normalizeEntry(raw, packIds, fallbackDay = dayKey()) {
  if (!raw || typeof raw.w !== 'string') return null
  const packs = Array.isArray(raw.packs) ? raw.packs.filter((id) => packIds.has(id)) : []
  const rawSrs = raw.srs && typeof raw.srs === 'object' ? raw.srs : {}
  const due = isValidDay(rawSrs.due) ? rawSrs.due : fallbackDay
  const reps = clampInt(rawSrs.reps, 0, 0, 10000)
  const interval = clampInt(rawSrs.interval, 1, 1, 365)
  const ef = clampNumber(rawSrs.ef, 2.5, 1.3, 2.8)
  const good = clampInt(rawSrs.good, 0, 0, 1000000)
  const hard = clampInt(rawSrs.hard, 0, 0, 1000000)
  const again = clampInt(rawSrs.again, 0, 0, 1000000)
  const lapses = clampInt(rawSrs.lapses, 0, 0, 1000000)
  const wrongStreak = clampInt(rawSrs.wrongStreak, 0, 0, 1000000)
  const lastAt = Number.isFinite(Number(rawSrs.lastAt)) ? Number(rawSrs.lastAt) : 0
  const lastGrade = ['good', 'hard', 'again'].includes(rawSrs.lastGrade) ? rawSrs.lastGrade : null
  const lastRecheck = isValidDay(rawSrs.lastRecheck) ? rawSrs.lastRecheck : ''
  const srs = {
    ...defaultSrs(due),
    ...rawSrs,
    due,
    reps,
    interval,
    ef,
    good,
    hard,
    again,
    lapses,
    wrongStreak,
    lastGrade,
    lastAt,
    lastRecheck,
  }
  srs.retrievalGoodDays = Array.isArray(rawSrs.retrievalGoodDays)
    ? [...new Set(rawSrs.retrievalGoodDays.filter((day) => isValidDay(day)))].slice(-60)
    : []
  srs.productionGoodDays = Array.isArray(rawSrs.productionGoodDays)
    ? [...new Set(rawSrs.productionGoodDays.filter((day) => isValidDay(day)))].slice(-60)
    : []
  return {
    w: raw.w.toLowerCase(),
    packs,
    ph: String(raw.ph ?? ''),
    pos: String(raw.pos ?? ''),
    cn: String(raw.cn ?? ''),
    sense: String(raw.sense ?? raw.cn ?? ''),
    rank: Number.isFinite(Number(raw.rank)) ? Number(raw.rank) : 999999,
    addedAt: Number.isFinite(Number(raw.addedAt)) && Number(raw.addedAt) > 0 ? Number(raw.addedAt) : Date.now(),
    updatedAt: Number.isFinite(Number(raw.updatedAt)) && Number(raw.updatedAt) > 0 ? Number(raw.updatedAt) : Date.now(),
    source: ['manual', 'auto', 'import'].includes(raw.source) ? raw.source : 'manual',
    auto: raw.auto === true,
    autoState: raw.autoState === 'parked' ? 'parked' : 'active',
    contextZh: String(raw.contextZh ?? ''),
    note: String(raw.note ?? ''),
    excludedFromChat: raw.excludedFromChat === true,
    srs,
    stats: {
      seen: clampInt(raw.stats?.seen, 0, 0, 1000000),
      graded: clampInt(raw.stats?.graded, 0, 0, 1000000),
      lastSeenDay: isValidDay(raw.stats?.lastSeenDay) ? raw.stats.lastSeenDay : '',
    },
  }
}

class WordbookService {
  constructor({ dataDir, packsDir = PACKS_DIR, logger = console, now = () => new Date() }) {
    this.dataDir = dataDir
    this.packsDir = packsDir
    this.logger = logger
    this.now = now
    this.packs = loadPacks(packsDir)
    this.packIds = new Set(this.packs.packs.keys())
    this.wordbookPath = join(dataDir, 'wordbook.json')
    this.inboxPath = join(dataDir, 'inbox.json')
    this.lastCapture = null
    this.corrupt = false
    this.inbox = this.loadInbox()
    this.state = this.loadState()
    this.parkStaleAuto()
  }

  today() {
    return dayKey(this.now())
  }

  ensureDir() {
    mkdirSync(this.dataDir, { recursive: true })
  }

  loadInbox() {
    this.ensureDir()
    const empty = { version: 1, items: [], byDay: {}, updatedAt: 0 }
    if (!existsSync(this.inboxPath)) return empty
    try {
      const parsed = JSON.parse(readFileSync(this.inboxPath, 'utf8'))
      return {
        version: 1,
        items: Array.isArray(parsed.items) ? parsed.items.filter((item) => item && typeof item.w === 'string') : [],
        byDay: parsed.byDay && typeof parsed.byDay === 'object' ? parsed.byDay : {},
        updatedAt: Number(parsed.updatedAt) || 0,
      }
    } catch (error) {
      this.warn(`inbox corrupted: ${error instanceof Error ? error.message : String(error)}`)
      const corruptPath = `${this.inboxPath}.corrupt.${Date.now()}`
      try { renameSync(this.inboxPath, corruptPath) } catch { /* keep the original if rename fails */ }
      const backup = this.latestInboxBackup()
      if (backup) {
        try {
          const parsed = JSON.parse(readFileSync(backup, 'utf8'))
          this.warn(`inbox restored from ${backup}`)
          return {
            version: 1,
            items: Array.isArray(parsed.items) ? parsed.items.filter((item) => item && typeof item.w === 'string') : [],
            byDay: parsed.byDay && typeof parsed.byDay === 'object' ? parsed.byDay : {},
            updatedAt: Number(parsed.updatedAt) || 0,
          }
        } catch { /* fall through to empty */ }
      }
      return empty
    }
  }

  latestInboxBackup() {
    try {
      const files = readdirSync(this.dataDir)
        .filter((name) => name.startsWith('inbox.json.bak-'))
        .sort()
        .reverse()
      return files.length > 0 ? join(this.dataDir, files[0]) : null
    } catch {
      return null
    }
  }

  loadState() {
    this.ensureDir()
    const fallback = emptyState(normalizeSettings(null, this.packIds))
    if (!existsSync(this.wordbookPath)) {
      this.state = fallback
      this.saveState()
      return this.state
    }
    try {
      const parsed = JSON.parse(readFileSync(this.wordbookPath, 'utf8'))
      return this.normalizeState(parsed, this.today())
    } catch (error) {
      this.warn(`wordbook corrupted: ${error instanceof Error ? error.message : String(error)}`)
      this.corrupt = true
      const corruptPath = `${this.wordbookPath}.corrupt.${Date.now()}`
      try { renameSync(this.wordbookPath, corruptPath) } catch { /* keep the original if rename fails */ }
      const backup = this.latestBackup()
      if (backup) {
        try {
          const parsed = JSON.parse(readFileSync(backup, 'utf8'))
          this.warn(`restored from ${backup}`)
          const restored = this.normalizeState(parsed, this.today())
          this.state = restored
          this.saveState()
          return restored
        } catch { /* try empty state */ }
      }
      this.state = fallback
      this.saveState()
      return fallback
    }
  }

  latestBackup() {
    try {
      const files = readdirSync(this.dataDir)
        .filter((name) => name.startsWith('wordbook.json.bak-'))
        .sort()
        .reverse()
      return files.length > 0 ? join(this.dataDir, files[0]) : null
    } catch {
      return null
    }
  }

  normalizeState(parsed, fallbackDay = this.today()) {
    const state = emptyState(normalizeSettings(parsed?.settings ?? null, this.packIds))
    state.version = 1
    state.revision = Number(parsed?.revision) || 0
    state.updatedAt = Number(parsed?.updatedAt) || 0
    state.words = {}
    let wordCount = 0
    for (const [key, raw] of Object.entries(parsed?.words ?? {})) {
      if (wordCount >= MAX_WORDS) break
      const entry = normalizeEntry({ ...raw, w: raw?.w ?? key }, this.packIds, fallbackDay)
      if (entry && WORD_RE.test(entry.w) && !Object.prototype.hasOwnProperty.call(state.words, entry.w)) {
        state.words[entry.w] = entry
        wordCount += 1
      }
    }
    state.notes = Array.isArray(parsed?.notes)
      ? parsed.notes.filter((note) => note && typeof note.text === 'string').slice(0, MAX_NOTES).map((note) => ({
        id: String(note.id ?? `note-${Date.now()}`),
        text: String(note.text).slice(0, 5000),
        createdAt: Number(note.createdAt) || Date.now(),
        updatedAt: Number(note.updatedAt) || Date.now(),
      }))
      : []
    state.dayStats = {}
    if (parsed?.dayStats && typeof parsed.dayStats === 'object' && !Array.isArray(parsed.dayStats)) {
      for (const [day, raw] of Object.entries(parsed.dayStats)) {
        if (!isValidDay(day) || !raw || typeof raw !== 'object') continue
        state.dayStats[day] = {
          graded: clampInt(raw.graded, 0, 0, 1000000),
          good: clampInt(raw.good, 0, 0, 1000000),
          hard: clampInt(raw.hard, 0, 0, 1000000),
          again: clampInt(raw.again, 0, 0, 1000000),
          added: clampInt(raw.added, 0, 0, 1000000),
          autoAdded: clampInt(raw.autoAdded, 0, 0, 1000000),
        }
      }
    }
    state.streak = parsed?.streak && typeof parsed.streak === 'object' && isValidDay(parsed.streak.lastDay)
      ? { days: clampInt(parsed.streak.days, 0, 0, 100000), lastDay: parsed.streak.lastDay }
      : { days: 0, lastDay: '' }
    state.dismissedWords = Array.isArray(parsed?.dismissedWords)
      ? parsed.dismissedWords.filter((word) => typeof word === 'string' && WORD_RE.test(word)).slice(-MAX_DISMISSED)
      : []
    state.recentCommandIds = Array.isArray(parsed?.recentCommandIds)
      ? parsed.recentCommandIds.filter((id) => typeof id === 'string').slice(-MAX_RECENT_COMMANDS)
      : []
    return state
  }

  saveState() {
    this.ensureDir()
    const today = this.today()
    const backup = `${this.wordbookPath}.bak-${today}`
    if (!existsSync(backup) && existsSync(this.wordbookPath)) {
      try { copyFileSync(this.wordbookPath, backup) } catch { /* best effort */ }
    }
    this.pruneBackups()
    const tmp = `${this.wordbookPath}.tmp`
    const body = JSON.stringify(this.state, null, 1)
    writeFileSync(tmp, body, 'utf8')
    try { renameSync(tmp, this.wordbookPath) } catch {
      writeFileSync(this.wordbookPath, body, 'utf8')
      try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
    }
  }

  pruneBackups() {
    try {
      const files = readdirSync(this.dataDir).filter((name) => name.startsWith('wordbook.json.bak-')).sort().reverse()
      for (const name of files.slice(7)) rmSync(join(this.dataDir, name), { force: true })
    } catch { /* best effort */ }
  }

  saveInbox() {
    this.ensureDir()
    const backup = `${this.inboxPath}.bak-${this.today()}`
    if (!existsSync(backup) && existsSync(this.inboxPath)) {
      try { copyFileSync(this.inboxPath, backup) } catch { /* best effort */ }
    }
    try {
      const files = readdirSync(this.dataDir).filter((name) => name.startsWith('inbox.json.bak-')).sort().reverse()
      for (const name of files.slice(7)) rmSync(join(this.dataDir, name), { force: true })
    } catch { /* best effort */ }
    this.inbox.updatedAt = Date.now()
    const tmp = `${this.inboxPath}.tmp`
    const body = JSON.stringify(this.inbox, null, 1)
    writeFileSync(tmp, body, 'utf8')
    try { renameSync(tmp, this.inboxPath) } catch {
      writeFileSync(this.inboxPath, body, 'utf8')
      try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
    }
  }

  warn(message) {
    try { this.logger?.warn?.(`[dsh-word-veil] ${message}`) } catch { /* ignore */ }
  }

  stateSnapshot() {
    this.parkStaleAuto(false)
    return {
      version: 1,
      revision: this.state.revision,
      settings: this.state.settings,
      words: this.state.words,
      notes: this.state.notes,
      dayStats: this.state.dayStats,
      streak: this.state.streak,
      updatedAt: this.state.updatedAt,
    }
  }

  summary() {
    this.parkStaleAuto(false)
    const today = this.today()
    const words = Object.values(this.state.words)
    const due = words.filter((word) => word.srs?.due && word.srs.due <= today && word.autoState !== 'parked')
    const newAuto = words.filter((word) => word.auto
      && dayKey(new Date(word.addedAt)) === today
      && (word.stats?.graded ?? 0) === 0
      && word.autoState !== 'parked')
    const day = this.state.dayStats[today] ?? { graded: 0 }
    const streakDays = this.state.streak.lastDay === today || this.state.streak.lastDay === addDays(today, -1)
      ? (this.state.streak.days || 0)
      : 0
    return {
      revision: this.state.revision,
      dueCount: due.length,
      newAutoCount: newAuto.length,
      actedToday: (day.graded ?? 0) > 0,
      candidates: this.inbox.items.length,
      wordCount: words.length,
      masteredCount: words.filter((word) => isMastered(word.srs)).length,
      stubbornCount: words.filter((word) => isStubborn(word.srs)).length,
      streakDays,
      todayGraded: day.graded ?? 0,
      enabled: this.state.settings.enabled === true,
      onboardingDone: this.state.settings.onboardingDone,
      corrupt: this.corrupt,
      packs: this.packs.index.map((meta) => ({ id: meta.id, name: meta.name, wordCount: meta.wordCount })),
    }
  }

  packList() {
    return this.packs.index
  }

  packData(id) {
    return this.packs.packs.get(id)?.data ?? null
  }

  enabledWordMap() {
    const enabled = new Set(this.state.settings.packs.enabled)
    const map = new Map()
    for (const [word, entry] of this.packs.allWords) {
      if (entry.packs.some((id) => enabled.has(id))) map.set(word, entry)
    }
    return map
  }

  lookupWord(word) {
    return this.packs.allWords.get(String(word ?? '').toLowerCase()) ?? null
  }

  addWord(payload, { source = 'manual', auto = false } = {}) {
    const w = String(payload?.w ?? '').trim().toLowerCase()
    if (!WORD_RE.test(w)) throw new Error('invalid word')
    const known = this.lookupWord(w)
    if (!known && !String(payload?.cn ?? '').trim()) throw new Error('word not found in the bundled packs')
    this.state.dismissedWords = this.state.dismissedWords.filter((item) => item !== w)
    const packs = Array.isArray(payload?.packs) ? payload.packs.filter((id) => this.packIds.has(id)) : (known?.packs ?? [])
    const existing = this.state.words[w]
    if (existing) {
      for (const id of packs) if (!existing.packs.includes(id)) existing.packs.push(id)
      if (payload?.contextZh) existing.contextZh = String(payload.contextZh).slice(0, 200)
      if (payload?.note) existing.note = String(payload.note).slice(0, 5000)
      if (source === 'manual' || source === 'import') {
        existing.auto = false
        existing.source = source
        existing.addedAt = Date.now()
      }
      existing.autoState = 'active'
      existing.updatedAt = Date.now()
      return existing
    }
    if (Object.keys(this.state.words).length >= MAX_WORDS) throw new Error('wordbook is full')
    const today = this.today()
    const due = isValidDay(payload?.due) ? payload.due : today
    const entry = {
      w,
      packs,
      ph: String(payload?.ph ?? known?.ph ?? ''),
      pos: String(payload?.pos ?? known?.pos ?? ''),
      cn: String(payload?.cn ?? known?.cn ?? ''),
      sense: String(payload?.sense ?? payload?.cn ?? known?.cn ?? ''),
      rank: Number(payload?.rank ?? known?.rank) || 999999,
      addedAt: Date.now(),
      updatedAt: Date.now(),
      source,
      auto: auto || source === 'auto',
      autoState: 'active',
      contextZh: String(payload?.contextZh ?? '').slice(0, 200),
      note: String(payload?.note ?? '').slice(0, 5000),
      excludedFromChat: false,
      srs: defaultSrs(due),
      stats: { seen: 1, graded: 0, lastSeenDay: today },
    }
    this.state.words[w] = entry
    const day = this.state.dayStats[today] ?? { graded: 0, good: 0, hard: 0, again: 0, added: 0, autoAdded: 0 }
    day.added = (day.added ?? 0) + 1
    if (entry.auto) day.autoAdded = (day.autoAdded ?? 0) + 1
    this.state.dayStats[today] = day
    return entry
  }

  deleteWord(w) {
    const key = String(w ?? '').toLowerCase()
    if (!WORD_RE.test(key) || !Object.prototype.hasOwnProperty.call(this.state.words, key)) throw new Error('word not found')
    const entry = this.state.words[key]
    delete this.state.words[key]
    if (entry.auto) {
      const addedDay = this.state.dayStats[dayKey(new Date(entry.addedAt))]
      if (addedDay && addedDay.autoAdded > 0) addedDay.autoAdded -= 1
    }
    // A deleted word must not silently reappear through auto-capture.
    this.state.dismissedWords.push(key)
    this.state.dismissedWords = [...new Set(this.state.dismissedWords)].slice(-MAX_DISMISSED)
  }

  updateWord(w, patch) {
    const key = String(w ?? '').toLowerCase()
    if (!WORD_RE.test(key) || !Object.prototype.hasOwnProperty.call(this.state.words, key)) throw new Error('word not found')
    const entry = this.state.words[key]
    if (typeof patch?.note === 'string') entry.note = patch.note.slice(0, 5000)
    if (typeof patch?.contextZh === 'string') entry.contextZh = patch.contextZh.slice(0, 200)
    if (typeof patch?.sense === 'string') entry.sense = patch.sense.slice(0, 300)
    if (typeof patch?.excludedFromChat === 'boolean') entry.excludedFromChat = patch.excludedFromChat
    if (patch?.autoState === 'parked' || patch?.autoState === 'active') entry.autoState = patch.autoState
    entry.updatedAt = Date.now()
    return entry
  }

  gradeWord(payload) {
    const key = String(payload?.w ?? '').toLowerCase()
    if (!WORD_RE.test(key) || !Object.prototype.hasOwnProperty.call(this.state.words, key)) throw new Error('word not found')
    const entry = this.state.words[key]
    const result = ['good', 'hard', 'again'].includes(payload?.result) ? payload.result : null
    if (!result) throw new Error('invalid grade result')
    const retrieval = payload?.retrieval === true
    const mode = ['en2cn', 'cn2en', 'cloze', 'spell'].includes(payload?.mode) ? payload.mode : 'en2cn'
    const today = this.today()
    entry.srs = gradeSrs(entry.srs, result, { retrieval, mode, today, maxIntervalDays: this.state.settings.srs.maxIntervalDays })
    entry.autoState = 'active'
    entry.updatedAt = Date.now()
    entry.stats.graded = (entry.stats.graded ?? 0) + 1
    entry.stats.lastSeenDay = today
    const day = this.state.dayStats[today] ?? { graded: 0, good: 0, hard: 0, again: 0, added: 0, autoAdded: 0 }
    day[result] = (day[result] ?? 0) + 1
    if (retrieval) day.graded = (day.graded ?? 0) + 1
    this.state.dayStats[today] = day
    if (retrieval) {
      if (this.state.streak.lastDay !== today) {
        this.state.streak.days = this.state.streak.lastDay === addDays(today, -1)
          ? (this.state.streak.days || 0) + 1
          : 1
        this.state.streak.lastDay = today
      }
    }
    return entry
  }

  addNote(payload) {
    if (this.state.notes.length >= MAX_NOTES) throw new Error('too many notes')
    const note = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: String(payload?.text ?? '').slice(0, 5000),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.state.notes.push(note)
    return note
  }

  updateNote(payload) {
    const note = this.state.notes.find((item) => item.id === payload?.id)
    if (!note) throw new Error('note not found')
    note.text = String(payload?.text ?? note.text).slice(0, 5000)
    note.updatedAt = Date.now()
    return note
  }

  deleteNote(id) {
    const before = this.state.notes.length
    this.state.notes = this.state.notes.filter((note) => note.id !== id)
    if (this.state.notes.length === before) throw new Error('note not found')
  }

  addCandidate(entry, context, sessionId, packs) {
    const today = this.today()
    const id = `${today}:${entry.w}`
    if (this.inbox.items.some((item) => item.id === id)) return false
    const used = Number(this.inbox.byDay[today] ?? 0)
    if (used >= 20) return false
    this.inbox.items.push({
      id,
      w: entry.w,
      packs,
      rank: entry.rank,
      at: Date.now(),
      day: today,
      context: String(context ?? '').slice(0, 240),
      sessionId: String(sessionId ?? ''),
    })
    this.inbox.byDay[today] = used + 1
    this.pruneInbox()
    return true
  }

  pruneInbox() {
    const cutoff = addDays(this.today(), -14)
    this.inbox.items = this.inbox.items.filter((item) => item.day >= cutoff).slice(-200)
    this.inbox.byDay = Object.fromEntries(Object.entries(this.inbox.byDay ?? {}).filter(([day]) => day >= cutoff))
  }

  acceptCandidate(id) {
    const item = this.inbox.items.find((candidate) => candidate.id === id)
    if (!item) throw new Error('candidate not found')
    if (this.state.dismissedWords.includes(item.w)) {
      this.inbox.items = this.inbox.items.filter((candidate) => candidate.id !== id)
      return { skipped: 'dismissed', w: item.w }
    }
    const entry = this.addWord({ w: item.w, packs: item.packs, contextZh: item.context, due: this.today() }, { source: 'auto', auto: true })
    this.inbox.items = this.inbox.items.filter((candidate) => candidate.id !== id)
    return entry
  }

  dismissCandidate(id) {
    const item = this.inbox.items.find((candidate) => candidate.id === id)
    if (!item) throw new Error('candidate not found')
    this.inbox.items = this.inbox.items.filter((candidate) => candidate.id !== id)
    this.state.dismissedWords.push(item.w)
    this.state.dismissedWords = [...new Set(this.state.dismissedWords)].slice(-MAX_DISMISSED)
  }

  clearAutoCapture() {
    for (const [w, entry] of Object.entries(this.state.words)) {
      if (entry.auto && (entry.stats?.graded ?? 0) === 0) delete this.state.words[w]
    }
    const day = this.state.dayStats[this.today()]
    if (day) day.autoAdded = 0
    this.inbox.items = []
    this.inbox.byDay = {}
  }

  parkStaleAuto(persist = true) {
    const today = this.today()
    let changed = false
    for (const entry of Object.values(this.state.words)) {
      if (!entry.auto || entry.autoState === 'parked' || (entry.stats?.graded ?? 0) > 0) continue
      if (dayDiff(dayKey(new Date(entry.addedAt)), today) >= 3) {
        entry.autoState = 'parked'
        entry.updatedAt = Date.now()
        changed = true
      }
    }
    if (changed && persist) {
      this.state.revision += 1
      this.state.updatedAt = Date.now()
      this.saveState()
    }
    return changed
  }

  captureText(text, sessionId) {
    if (!this.state.settings.enabled || !this.state.settings.autoCapture.enabled) return { added: [], candidates: [] }
    const cleaned = cleanUserText(text)
    if (!cleaned || cleaned.startsWith('/')) return { added: [], candidates: [] }
    const tokens = tokensOf(cleaned)
    const map = this.enabledWordMap()
    const seen = new Set()
    const scored = []
    for (const token of tokens) {
      if (seen.has(token.word)) continue
      seen.add(token.word)
      if (AUTO_STOPWORDS.has(token.word)) continue
      if (this.state.dismissedWords.includes(token.word)) continue
      if (this.state.words[token.word]?.excludedFromChat) continue
      if (isCapitalizedNonSentence(cleaned, token)) continue
      const entry = map.get(token.word)
      if (!entry) continue
      scored.push({ ...token, entry, score: scoreToken(token, cleaned, entry) })
    }
    const lookup = scored.filter((token) => LOOKUP_RE.test(cleaned.slice(Math.max(0, token.index - 30), token.index + token.raw.length + 30)))
    const short = cleaned.length <= 240
    const max = this.state.settings.autoCapture.maxPerMessage
    const direct = lookup.length > 0
      ? lookup.sort((a, b) => b.score - a.score || a.entry.rank - b.entry.rank).slice(0, Math.min(2, max))
      : short
        ? scored.sort((a, b) => b.score - a.score || a.entry.rank - b.entry.rank).slice(0, max)
        : []
    const candidates = short ? [] : scored.sort((a, b) => b.score - a.score || a.entry.rank - b.entry.rank).slice(0, 5)
    const today = this.today()
    const day = this.state.dayStats[today] ?? { graded: 0, good: 0, hard: 0, again: 0, added: 0, autoAdded: 0 }
    let autoAdded = Number(day.autoAdded) || 0
    const added = []
    const candidateWords = []
    for (const token of direct) {
      if (AUTO_STOPWORDS.has(token.word)) continue
      if (this.state.dismissedWords.includes(token.word)) continue
      const existing = this.state.words[token.word]
      if (existing) {
        if (existing.excludedFromChat) continue
        if (existing.contextZh === '') existing.contextZh = sentenceAround(cleaned, token.index, token.raw.length)
        if (existing.stats.lastSeenDay !== today) {
          existing.stats.seen = (existing.stats.seen ?? 0) + 1
          existing.stats.lastSeenDay = today
        }
        existing.updatedAt = Date.now()
        added.push(token.word)
        continue
      }
      if (autoAdded >= this.state.settings.autoCapture.dailyCap) {
        if (this.addCandidate(token.entry, sentenceAround(cleaned, token.index, token.raw.length), sessionId, token.entry.packs)) candidateWords.push(token.word)
        continue
      }
      this.addWord({
        w: token.word,
        packs: token.entry.packs,
        ph: token.entry.ph,
        pos: token.entry.pos,
        cn: token.entry.cn,
        rank: token.entry.rank,
        contextZh: sentenceAround(cleaned, token.index, token.raw.length),
      }, { source: 'auto', auto: true })
      autoAdded += 1
      added.push(token.word)
    }
    for (const token of candidates) {
      if (AUTO_STOPWORDS.has(token.word)) continue
      if (this.state.dismissedWords.includes(token.word)) continue
      if (this.state.words[token.word]) continue
      if (this.addCandidate(token.entry, sentenceAround(cleaned, token.index, token.raw.length), sessionId, token.entry.packs)) candidateWords.push(token.word)
    }
    if (added.length > 0) {
      const current = this.state.dayStats[today] ?? { graded: 0, good: 0, hard: 0, again: 0, added: 0, autoAdded: 0 }
      current.autoAdded = autoAdded
      this.state.dayStats[today] = current
    }
    if (added.length > 0 || candidateWords.length > 0) this.lastCapture = Date.now()
    return { added, candidates: candidateWords }
  }

  handleSessionEvent(session, event) {
    if (!this.state.settings.enabled) return
    if (!this.state.settings.autoCapture.enabled) return
    if (!event || event.type !== 'user/message') return
    if (event.data?.source?.kind !== 'user') return
    const header = session?.header ?? session
    if (header?.origin === 'subagent' || (typeof header?.delegationDepth === 'number' && header.delegationDepth > 0)) return
    const cwd = String(header?.cwd ?? '')
    if (cwd && this.state.settings.autoCapture.excludeCwdPatterns.some((pattern) => cwd.toLowerCase().includes(pattern.toLowerCase()))) return
    const content = Array.isArray(event.data?.content) ? event.data.content : []
    const text = content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n')
    if (!text.trim()) return
    const result = this.captureText(text, header?.id ?? session?.id ?? '')
    if (result.added.length > 0 || result.candidates.length > 0) {
      this.state.revision += 1
      this.state.updatedAt = Date.now()
      this.saveState()
      this.saveInbox()
    }
  }

  execute(command) {
    const id = String(command?.id ?? '')
    if (!id || typeof command?.type !== 'string') return { ok: false, error: { code: 'bad-command', message: 'id and type are required' } }
    if (this.state.recentCommandIds.includes(id)) return { ok: true, revision: this.state.revision, summary: this.summary(), duplicate: true }
    const before = JSON.parse(JSON.stringify(this.state))
    const inboxBefore = JSON.parse(JSON.stringify(this.inbox))
    try {
      const payload = command.payload ?? {}
      let result = null
      switch (command.type) {
        case 'completeOnboarding': {
          const current = this.state.settings
          const merged = {
            ...current,
            ...payload,
            packs: { ...current.packs, ...(payload.packs ?? {}) },
            daily: { ...current.daily, ...(payload.daily ?? {}) },
            autoCapture: { ...current.autoCapture, ...(payload.autoCapture ?? {}) },
            badge: { ...current.badge, ...(payload.badge ?? {}) },
            examDates: payload.examDates ?? current.examDates,
            enabled: payload.enabled !== false,
            onboardingDone: true,
          }
          const settings = normalizeSettings(merged, this.packIds)
          if (settings.packs.enabled.length === 0) throw new Error('at least one exam pack is required')
          if (!payload.autoCapture || payload.autoCapture.dailyCap === undefined) settings.autoCapture.dailyCap = settings.daily.autoCap
          this.state.settings = settings
          result = { onboardingDone: true }
          break
        }
        case 'updateSettings': {
          const current = this.state.settings
          const merged = {
            ...current,
            ...payload,
            packs: { ...current.packs, ...(payload.packs ?? {}) },
            daily: { ...current.daily, ...(payload.daily ?? {}) },
            autoCapture: { ...current.autoCapture, ...(payload.autoCapture ?? {}) },
            badge: { ...current.badge, ...(payload.badge ?? {}) },
            examDates: payload.examDates ?? current.examDates,
          }
          const next = normalizeSettings(merged, this.packIds)
          if (next.packs.enabled.length === 0) throw new Error('at least one exam pack is required')
          this.state.settings = next
          result = { settings: next }
          break
        }
        case 'addWord':
          result = this.addWord(payload, { source: payload.source === 'auto' ? 'auto' : 'manual', auto: payload.source === 'auto' })
          break
        case 'deleteWord':
          this.deleteWord(String(payload.w ?? '').toLowerCase())
          result = { deleted: payload.w }
          break
        case 'updateWord':
          result = this.updateWord(String(payload.w ?? '').toLowerCase(), payload)
          break
        case 'gradeWord':
          result = this.gradeWord(payload)
          break
        case 'restoreBackup':
          result = this.restoreBackup(payload)
          break
        case 'importProgress':
          result = this.importProgress(payload)
          break
        case 'addNote':
          result = this.addNote(payload)
          break
        case 'updateNote':
          result = this.updateNote(payload)
          break
        case 'deleteNote':
          this.deleteNote(payload.id)
          result = { deleted: payload.id }
          break
        case 'acceptCandidate':
          result = this.acceptCandidate(payload.id)
          break
        case 'dismissCandidate':
          this.dismissCandidate(payload.id)
          result = { dismissed: payload.id }
          break
        case 'clearAutoCapture':
          this.clearAutoCapture()
          result = { cleared: true }
          break
        case 'parkAutoWord':
          result = this.updateWord(String(payload.w ?? '').toLowerCase(), { autoState: 'parked' })
          break
        default:
          throw new Error(`unknown command: ${command.type}`)
      }
      this.state.revision += 1
      this.state.updatedAt = Date.now()
      this.state.recentCommandIds.push(id)
      this.state.recentCommandIds = this.state.recentCommandIds.slice(-MAX_RECENT_COMMANDS)
      this.parkStaleAuto(false)
      this.saveState()
      try { this.saveInbox() } catch (error) { this.warn(`inbox save failed: ${error instanceof Error ? error.message : String(error)}`) }
      return { ok: true, revision: this.state.revision, summary: this.summary(), result }
    } catch (error) {
      this.state = before
      this.inbox = inboxBefore
      return { ok: false, error: { code: 'command-failed', message: error instanceof Error ? error.message : String(error) } }
    }
  }

  restoreBackup(payload) {
    const data = payload?.state && typeof payload.state === 'object' ? payload.state : payload
    if (!data || typeof data !== 'object' || !data.words || typeof data.words !== 'object' || Array.isArray(data.words)) {
      throw new Error('invalid backup payload')
    }
    const restored = this.normalizeState(data, this.today())
    if (Object.keys(restored.words).length === 0 && Object.keys(data.words).length > 0) {
      throw new Error('backup has no valid words')
    }
    this.state = restored
    this.state.revision = Math.max(restored.revision, 1)
    this.state.updatedAt = Date.now()
    return {
      restoredWords: Object.keys(this.state.words).length,
      restoredNotes: this.state.notes.length,
      enabled: this.state.settings.enabled,
    }
  }

  importProgress(payload) {
    const words = payload?.words && typeof payload.words === 'object' ? payload.words : payload
    if (!words || typeof words !== 'object' || Array.isArray(words)) throw new Error('invalid progress payload')
    let imported = 0
    let skipped = 0
    for (const [rawWord, record] of Object.entries(words)) {
      if (!record || typeof record !== 'object') { skipped++; continue }
      const known = this.lookupWord(rawWord)
      if (!known) { skipped++; continue }
      const existing = this.state.words[String(rawWord).toLowerCase()]
      if (existing && ((existing.stats?.graded ?? 0) > 0 || (existing.srs?.lastAt ?? 0) > 0)) {
        skipped++
        continue
      }
      const today = this.today()
      const entry = this.addWord({
        w: rawWord,
        packs: known.packs,
        ph: known.ph,
        pos: known.pos,
        cn: known.cn,
        rank: known.rank,
        due: isValidDay(record.nextDue) ? record.nextDue : today,
      }, { source: 'import' })
      const right = clampInt(record.right, 0, 0, 1000000)
      const wrong = clampInt(record.wrong, 0, 0, 1000000)
      const streak = clampInt(record.streak, 0, 0, 1000000)
      const lastAt = Number.isFinite(Date.parse(record.last ? `${record.last}T00:00:00` : ''))
        ? Date.parse(`${record.last}T00:00:00`)
        : 0
      entry.srs = {
        ...defaultSrs(isValidDay(record.nextDue) ? record.nextDue : today),
        reps: Math.min(3, streak || (right > 0 ? 1 : 0)),
        interval: streak >= 3 ? 8 : streak >= 1 ? 3 : 1,
        ef: 2.5,
        lastGrade: right > 0 ? 'good' : wrong > 0 ? 'again' : null,
        lastAt,
        lapses: wrong,
        good: right,
        hard: 0,
        again: wrong,
        wrongStreak: 0,
      }
      imported++
    }
    return { imported, skipped }
  }

  review(scope, limit) {
    this.parkStaleAuto(false)
    const today = this.today()
    const max = clampInt(limit, 25, 1, 200)
    const gradedToday = this.state.dayStats[today]?.graded ?? 0
    const remaining = scope === 'due'
      ? Math.max(0, this.state.settings.daily.reviewCap - gradedToday)
      : max
    const take = Math.min(max, remaining)
    const primary = this.packs.packs.get(this.state.settings.packs.primary)
    const core = primary?.core ?? new Set()
    let words = Object.values(this.state.words)
    if (scope === 'mastered') words = words.filter((word) => isMastered(word.srs))
    else if (scope === 'stubborn') words = words.filter((word) => isStubborn(word.srs))
    else words = words.filter((word) => word.srs?.due && word.srs.due <= today && word.autoState !== 'parked')
    words.sort((a, b) => {
      const ac = core.has(a.w) ? 0 : 1
      const bc = core.has(b.w) ? 0 : 1
      if (ac !== bc) return ac - bc
      const as = isStubborn(a.srs) ? 0 : 1
      const bs = isStubborn(b.srs) ? 0 : 1
      if (as !== bs) return as - bs
      if (scope === 'due' && a.srs.due !== b.srs.due) return a.srs.due < b.srs.due ? -1 : 1
      return (a.rank ?? 999999) - (b.rank ?? 999999)
    })
    return words.slice(0, take).map((word) => ({
      w: word.w,
      packs: word.packs,
      ph: word.ph,
      pos: word.pos,
      cn: word.cn,
      sense: word.sense,
      rank: word.rank,
      srs: word.srs,
      auto: word.auto,
    }))
  }

  status() {
    let wordbookBytes = 0
    try { wordbookBytes = statSync(this.wordbookPath).size } catch { /* missing */ }
    const backups = (() => {
      try { return readdirSync(this.dataDir).filter((name) => name.startsWith('wordbook.json.bak-')).length } catch { return 0 }
    })()
    return {
      wordbookBytes,
      backups,
      inboxItems: this.inbox.items.length,
      lastCapture: this.lastCapture,
      corrupt: this.corrupt,
      packs: this.packs.index.map((meta) => ({ id: meta.id, wordCount: meta.wordCount, warnings: this.packs.warnings })),
    }
  }

  dispose() {
    try { this.saveState() } catch { /* best effort */ }
    try { this.saveInbox() } catch { /* best effort */ }
  }
}

function isLoopback(req) {
  const address = req?.socket?.remoteAddress
  if (!address) return false
  const normalized = String(address).replace(/^::ffff:/, '')
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost'
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0
    let tooLarge = false
    const chunks = []
    req.on('data', (chunk) => {
      if (tooLarge) return
      size += chunk.length
      if (size > limit) {
        tooLarge = true
        chunks.length = 0
        reject(Object.assign(new Error('body too large'), { code: 'payload-too-large' }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', (error) => { if (!tooLarge) reject(error) })
  })
}

/** Create the HTTP handler used by both the web server and the tests. */
export function createRouteHandler(service) {
  return async function handler(req, res) {
    try {
      if (!isLoopback(req)) return sendJson(res, 403, { ok: false, error: 'loopback only' })
      const hostHeader = String(req.headers?.host ?? '').toLowerCase()
      if (hostHeader) {
        const hostname = hostHeader.startsWith('[')
          ? hostHeader.slice(1, hostHeader.indexOf(']') >= 0 ? hostHeader.indexOf(']') : undefined)
          : hostHeader.replace(/:\d+$/, '')
        if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') {
          return sendJson(res, 403, { ok: false, error: 'unexpected host' })
        }
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname
      if (!path.startsWith(PREFIX)) return sendJson(res, 404, { ok: false, error: 'not found' })
      const rest = path.slice(PREFIX.length)
      const method = req.method ?? 'GET'
      if (rest === '/state' && method === 'GET') return sendJson(res, 200, { ok: true, state: service.stateSnapshot(), summary: service.summary() })
      if (rest === '/summary' && method === 'GET') return sendJson(res, 200, { ok: true, summary: service.summary() })
      if (rest === '/packs' && method === 'GET') return sendJson(res, 200, { ok: true, packs: service.packList() })
      if (rest.startsWith('/packs/') && method === 'GET') {
        let id
        try { id = decodeURIComponent(rest.slice('/packs/'.length)) } catch { return sendJson(res, 400, { ok: false, error: 'invalid pack id' }) }
        const data = service.packData(id)
        if (!data) return sendJson(res, 404, { ok: false, error: 'pack not found' })
        return sendJson(res, 200, { ok: true, pack: data })
      }
      if (rest === '/review' && method === 'GET') {
        const scope = url.searchParams.get('scope') ?? 'due'
        return sendJson(res, 200, { ok: true, targets: service.review(scope, url.searchParams.get('limit')) })
      }
      if (rest === '/inbox' && method === 'GET') return sendJson(res, 200, { ok: true, items: service.inbox.items, byDay: service.inbox.byDay })
      if (rest === '/inbox' && method === 'DELETE') {
        const result = service.execute({ id: `http-clear-${Date.now()}`, type: 'clearAutoCapture', payload: {} })
        if (!result.ok) return sendJson(res, 400, result)
        return sendJson(res, 200, { ok: true, cleared: true })
      }
      if (rest === '/status' && method === 'GET') return sendJson(res, 200, { ok: true, status: service.status() })
      if (rest === '/command' && method === 'POST') {
        const contentType = String(req.headers?.['content-type'] ?? '')
        if (!contentType.toLowerCase().startsWith('application/json')) {
          return sendJson(res, 415, { ok: false, error: 'content-type must be application/json' })
        }
        const body = await readBody(req)
        let command
        try { command = JSON.parse(body) } catch { return sendJson(res, 400, { ok: false, error: 'invalid json' }) }
        return sendJson(res, 200, service.execute(command))
      }
      return sendJson(res, 404, { ok: false, error: 'not found' })
    } catch (error) {
      const code = error?.code === 'payload-too-large' ? 413 : 500
      return sendJson(res, code, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
}

export function resolveDataDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const next = join(home, 'plugins-data', 'dsh-word-veil')
  const legacy = join(home, 'plugins-data', 'dsh-en-wordbook')
  if (!existsSync(next) && existsSync(legacy)) {
    try {
      mkdirSync(next, { recursive: true })
      for (const name of ['wordbook.json', 'inbox.json']) {
        const from = join(legacy, name)
        if (existsSync(from)) copyFileSync(from, join(next, name))
      }
    } catch {
      return legacy
    }
  }
  return next
}

/** Build the Host service without an Cordis context (tests use this). */
export function createService(options = {}) {
  return new WordbookService({
    dataDir: options.dataDir ?? resolveDataDir(),
    packsDir: options.packsDir ?? PACKS_DIR,
    logger: options.logger ?? console,
    now: options.now ?? (() => new Date()),
  })
}

export const inject = []

/** Cordis plugin entry: capture events and serve the local routes. */
export function apply(ctx) {
  try {
    const service = createService({ dataDir: resolveDataDir(), logger: ctx?.logger ?? console })
    if (typeof ctx?.effect === 'function') {
      ctx.effect(() => () => service.dispose(), 'dsh-word-veil: flush')
    }
    if (typeof ctx?.on === 'function') {
      ctx.effect(() => {
        const dispose = ctx.on('session/event', (session, event) => {
          try { service.handleSessionEvent(session, event) } catch (error) {
            try { ctx.logger?.warn?.(`[dsh-word-veil] capture: ${error instanceof Error ? error.message : String(error)}`) } catch { /* ignore */ }
          }
        })
        return dispose
      }, 'dsh-word-veil: session capture')
    }
    if (typeof ctx?.inject === 'function') {
      ctx.inject(['webServer'], (scope) => {
        if (typeof ctx.effect !== 'function') return
        ctx.effect(() => {
          try {
            return scope.webServer.register({ kind: 'prefix', path: PREFIX, handler: createRouteHandler(service) })
          } catch (error) {
            try { ctx.logger?.warn?.(`[dsh-word-veil] routes: ${error instanceof Error ? error.message : String(error)}`) } catch { /* ignore */ }
            return () => {}
          }
        }, 'dsh-word-veil: routes')
      })
    }
  } catch (error) {
    try { ctx?.logger?.error?.(`[dsh-word-veil] host apply failed: ${error instanceof Error ? error.message : String(error)}`) } catch { /* ignore */ }
  }
}
