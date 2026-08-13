import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The widget shell calls qdn-views:show across an IPC boundary with an untyped
// payload, so a wrong or renamed field is invisible to the compiler and only
// shows up as a runtime rejection in a packaged build. Sending nodeOrigin
// instead of nodeApiUrl did exactly that. This pins the field names together.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shellSource = readFileSync(
  path.join(repoRoot, 'src/v2/widget/WidgetShell.tsx'),
  'utf8',
)
const viewsSource = readFileSync(path.join(repoRoot, 'electron/qdn-views.ts'), 'utf8')

function sanitizeShowRequestBody() {
  const start = viewsSource.indexOf('function sanitizeShowRequest')
  assert.notEqual(start, -1, 'sanitizeShowRequest must exist in qdn-views.ts')
  const end = viewsSource.indexOf('\n}', start)
  assert.notEqual(end, -1, 'sanitizeShowRequest must have a closing brace')
  return viewsSource.slice(start, end)
}

const body = sanitizeShowRequestBody()

// Every value.<field> the sanitizer reads is part of the show contract.
const contractFields = [...body.matchAll(/value\.([A-Za-z0-9_]+)/g)].map(([, name]) => name)
assert.ok(contractFields.length > 0, 'expected sanitizeShowRequest to read request fields')

// These four have no fallback: omitting any of them throws rather than
// defaulting, so the widget shell must send all of them.
const required = ['nodeApiUrl', 'bounds', 'renderUrl', 'tabId']
for (const field of required) {
  assert.ok(
    contractFields.includes(field),
    `sanitizeShowRequest no longer reads ${field}; update this test and the widget shell`,
  )
  // Accept both `field: value` and the ES6 shorthand `field,`.
  assert.match(
    shellSource,
    new RegExp(`\\b${field}\\s*[:,}]`),
    `WidgetShell must send ${field} to qdn-views:show`,
  )
}

// nodeOrigin is what the sanitizer returns, not what it accepts. Sending it as
// a request field is the specific mistake this test exists to prevent.
assert.ok(
  !/nodeOrigin\s*:/.test(shellSource.slice(shellSource.indexOf('.show('))),
  'WidgetShell must not send nodeOrigin in the show request; the field is nodeApiUrl',
)

console.log('widget-shell-contract tests passed')
