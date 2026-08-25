import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const Prism = require('prismjs')
require('prismjs/components/prism-json.js')
require('prismjs/components/prism-bash.js')

export function highlightJson(json: string): string {
  try {
    JSON.parse(json)
    return Prism.highlight(json, Prism.languages.json, 'json')
  } catch {
    return ''
  }
}
export default Prism
