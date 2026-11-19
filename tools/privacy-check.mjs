/**
 * Fail a release if the working tree contains common personal/absolute-path
 * leaks. This is a guard, not a substitute for human review.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKIP_DIRS = new Set(['.git', 'node_modules', 'data', 'screenshots'])
const TEXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.html', '.css', '.svg', '.txt'])
const PATTERNS = [
  [/[A-Za-z]:\\Users\\/i, 'Windows user-profile path'],
  [/\/Users\/[^/\s]+/i, 'macOS user-profile path'],
  [/\/home\/[^/\s]+/i, 'Linux user-profile path'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'email address'],
]

const files = []
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name))
    } else if (TEXT.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
      files.push(join(dir, entry.name))
    }
  }
}
walk(ROOT)

const hits = []
for (const file of files) {
  let text
  try { text = readFileSync(file, 'utf8') } catch { continue }
  for (const [pattern, label] of PATTERNS) {
    const match = pattern.exec(text)
    if (match) hits.push(`${relative(ROOT, file)}: ${label}: ${match[0]}`)
  }
}

if (hits.length > 0) {
  console.error('[privacy] possible personal data:')
  for (const hit of hits) console.error(` - ${hit}`)
  process.exitCode = 1
} else {
  console.log(`[privacy] ok (${files.length} text files)`)
}
