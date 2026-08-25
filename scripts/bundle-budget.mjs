/**
 * Bundle budget check (issue #34 acceptance criteria).
 *
 * Run after `pnpm build`: asserts the client JS bundle stays under budget.
 * Wire into CI:  pnpm build && node scripts/bundle-budget.mjs
 *
 * Budgets are gzipped sizes per chunk class. Tune as the app grows —
 * increases must be justified in the PR description.
 */

import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = '.output'
const CLIENT_DIR = process.env.BUNDLE_CLIENT_DIR ?? join(DIST, 'public')

// Budget: total client JS ≤ 700 KB gzipped; any single initial chunk ≤ 250 KB.
const TOTAL_BUDGET_KB = Number(process.env.BUNDLE_BUDGET_TOTAL_KB ?? 700)
const CHUNK_BUDGET_KB = Number(process.env.BUNDLE_BUDGET_CHUNK_KB ?? 250)

function walk(dir) {
  let out = []
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out = out.concat(walk(p))
    else out.push(p)
  }
  return out
}

function gzipSize(file) {
  const buf = readFileSync(file)
  return gzipSync(buf).length
}

const jsFiles = walk(CLIENT_DIR).filter((f) => f.endsWith('.js'))
if (!jsFiles.length) {
  console.error(`bundle-budget: no .js files found under ${CLIENT_DIR} — run "pnpm build" first.`)
  process.exit(1)
}

let totalGz = 0
let failed = false
console.log('file'.padEnd(60), 'gzip KB')
for (const f of jsFiles) {
  const gz = gzipSize(f)
  totalGz += gz
  const kb = gz / 1024
  const rel = f.replace(CLIENT_DIR + '/', '')
  console.log(rel.padEnd(60), kb.toFixed(1))
  if (kb > CHUNK_BUDGET_KB) {
    console.error(`✗ ${rel} exceeds per-chunk budget (${kb.toFixed(1)} KB > ${CHUNK_BUDGET_KB} KB)`)
    failed = true
  }
}

const totalKb = totalGz / 1024
console.log('-'.repeat(70))
console.log(`total`.padEnd(60), `${totalKb.toFixed(1)} KB / ${TOTAL_BUDGET_KB} KB`)

if (totalKb > TOTAL_BUDGET_KB) {
  console.error(`✗ total bundle exceeds budget (${totalKb.toFixed(1)} KB > ${TOTAL_BUDGET_KB} KB)`)
  process.exit(1)
}
if (failed) process.exit(1)
console.log('✓ bundle budget OK')
