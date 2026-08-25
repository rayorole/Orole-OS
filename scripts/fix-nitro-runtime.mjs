/**
 * Post-build fix for the nitro 3 beta SSR chunking bug.
 *
 * Rolldown emits shared runtime helpers (`__exportAll`, `__defProp`, …) as
 * `var x = (...) => {...}` inside chunks that participate in circular
 * imports. With a cycle, the importing module evaluates first and sees the
 * binding as undefined → "TypeError: __exportAll is not a function" at
 * runtime (500 on every SSR request).
 *
 * Rewriting the helper declarations as hoisted `function` statements makes
 * them available regardless of module evaluation order.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['.output/server/_ssr', '.output/server/chunks', '.output/server']
const HELPERS = ['__exportAll', '__defProp', '__getOwnPropDesc', '__getOwnPropNames', '__getProtoOf', '__commonJSMin', '__toESM', '__toCommonJS']

// var NAME = (...) => {  →  hoisted function
function makePattern(name) {
  return new RegExp(`var ${name} = \\(([^)]*)\\) => \\{`, 'g')
}

// Special cases: helpers assigned a plain value instead of an arrow body.
const ALIASES = [
  {
    from: /var __defProp = Object\.defineProperty;/g,
    to: 'function __defProp(...args) { return Object.defineProperty(...args); }',
  },
  {
    from: /var __getProtoOf = Object\.getPrototypeOf;/g,
    to: 'function __getProtoOf(...args) { return Object.getPrototypeOf(...args); }',
  },
]

let patched = 0
const seen = new Set()

for (const root of ROOTS) {
  let files
  try {
    files = readdirSync(root, { recursive: true })
  } catch {
    continue
  }
  for (const rel of files) {
    if (!rel.endsWith('.mjs') || seen.has(rel)) continue
    seen.add(rel)
    const path = join(root, rel)
    let src = readFileSync(path, 'utf8')
    let out = src
    for (const name of HELPERS) {
      out = out.replace(makePattern(name), (_m, args) => `function ${name}(${args}) {`)
    }
    for (const { from, to } of ALIASES) {
      out = out.replace(from, to)
    }
    if (out !== src) {
      writeFileSync(path, out)
      patched++
    }
  }
}
console.log(`[fix-nitro-runtime] rewrote helper declarations in ${patched} file(s)`)
