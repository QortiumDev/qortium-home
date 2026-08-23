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

for (const field of ['bridgeStates', 'displaySettings', 'managerRevisions']) {
  assert.match(
    shellSource,
    new RegExp(`\\b${field}\\s*:`),
    `WidgetShell must carry ${field} from its source tab into qdn-views:show`,
  )
}

// nodeOrigin is what the sanitizer returns, not what it accepts. Sending it as
// a request field is the specific mistake this test exists to prevent.
assert.ok(
  !/nodeOrigin\s*:/.test(shellSource.slice(shellSource.indexOf('.show('))),
  'WidgetShell must not send nodeOrigin in the show request; the field is nodeApiUrl',
)

// QdnViewContext.windowId holds a webContents id, not a BrowserWindow id.
// Resolving it with BrowserWindow.fromId works only for the very first window,
// so it succeeds for a normal tab and returns null for a widget window. That
// made WIDGET_CLOSE fail silently while every account prompt kept working.
const bridgeSource = readFileSync(
  path.join(repoRoot, 'electron/home-v2-app-bridge.ts'),
  'utf8',
)
assert.ok(
  !/BrowserWindow\.fromId\(\s*context\.windowId\s*\)/.test(bridgeSource),
  'context.windowId is a webContents id; resolve the window with getContextWindow instead',
)

// The same trap exists wherever a view context is turned back into a window.
assert.ok(
  /webContents\.fromId\(context\.windowId\)/.test(bridgeSource),
  'getContextWindow must resolve context.windowId through webContents.fromId',
)

// Diagnostics used while chasing that bug must not ship.
assert.ok(
  !/console\.log\(\s*[`'"]\[widget\]/.test(bridgeSource),
  'temporary [widget] diagnostics must be removed before shipping',
)

// --- Plan 2 boundaries -------------------------------------------------------

// The shell-initiated "Open as widget" resolves a view by tab. That lookup is
// keyed by the host window's webContents id, so it must be fed event.sender.id
// and never a BrowserWindow id.
assert.match(
  bridgeSource,
  /getQdnViewContextForTab\(event\.sender\.id,/,
  'getQdnViewContextForTab must be given the host webContents id, not a window id',
)

// A widget action must take its widget id from the calling view's own tabId.
// Reading it from the request would let any widget drag, resize or reshape
// another app's widget.
const widgetActionHandler = bridgeSource.slice(
  bridgeSource.indexOf('function handleWidgetAction'),
)
assert.ok(
  widgetActionHandler.startsWith('function handleWidgetAction'),
  'handleWidgetAction must exist in home-v2-app-bridge.ts',
)
assert.ok(
  !/request\.widgetId|requestValue\.widgetId/.test(bridgeSource),
  'a widget action must never take its widget id from the request',
)

// Every widget action has to be in the bridge catalogue, or it is rejected
// before any of the routing above is reached.
const actionsSource = readFileSync(
  path.join(repoRoot, 'electron/home-v2-app-actions.ts'),
  'utf8',
)
for (const action of [
  'OPEN_AS_WIDGET',
  'WIDGET_CLOSE',
  'WIDGET_END_DRAG',
  'WIDGET_GET_STATE',
  'WIDGET_RESIZE',
  'WIDGET_SET_REGIONS',
  'WIDGET_START_DRAG',
]) {
  assert.match(
    actionsSource,
    new RegExp(`'${action}'`),
    `${action} must be listed in the Home v2 app action catalogue`,
  )
}

// The renderer's permission handler is an allowlist that silently drops
// anything it does not recognise, so a prompt whose action is missing from
// bridge-permissions never reaches the user and the request just times out.
// That is precisely how OPEN_AS_WIDGET failed the first time.
const permissionsSource = readFileSync(
  path.join(repoRoot, 'src/v2/bridge-permissions.ts'),
  'utf8',
)
assert.match(
  permissionsSource,
  /'OPEN_AS_WIDGET'/,
  'OPEN_AS_WIDGET must be declared in src/v2/bridge-permissions.ts',
)

// A widget grant is keyed off context.resourceUrl, so a view that navigated
// in-place to another app's resource could otherwise open a floating window
// under the first app's grant. requireAccountReadPermission guards against
// exactly this; the widget gate is the more privileged of the two and must not
// be the one place that skips it, before the grant map is consulted and again
// after the user answers.
const widgetGate = bridgeSource.slice(
  bridgeSource.indexOf('async function requireWidgetPermission'),
  bridgeSource.indexOf('type PreparedWidgetLaunch'),
)
assert.ok(
  widgetGate.length > 0,
  'requireWidgetPermission must exist in home-v2-app-bridge.ts',
)
assert.equal(
  (widgetGate.match(/liveResourceMatchesGrant\(/g) ?? []).length,
  2,
  'the widget gate must check the live resource before the grant map and again after approval',
)

assert.match(
  bridgeSource,
  /readBoundedResponse\(response, 'GET', WIDGET_MANIFEST_MAX_BYTES\)/,
  'widget manifests must be bounded while streaming, before parsing',
)
const appLaunch = bridgeSource.indexOf("if (action === 'OPEN_AS_WIDGET')")
assert.ok(appLaunch >= 0, 'OPEN_AS_WIDGET dispatch must exist')
const appLaunchBody = bridgeSource.slice(appLaunch, appLaunch + 600)
assert.ok(
  appLaunchBody.indexOf('prepareWidgetLaunch(context)') < appLaunchBody.indexOf('requireWidgetPermission('),
  'a widget manifest must be discovered and validated before Home asks for permission',
)
for (const grantComponent of [
  'context.windowId',
  'context.tabId',
  'context.resourceUrl',
  "getHomeV2AppNetwork(protocol, 'OPEN_AS_WIDGET')",
  'context.accountId',
]) {
  assert.ok(widgetGate.includes(grantComponent), `widget grant must bind ${grantComponent}`)
}

// A runtime region push must be validated by the same parser the manifest
// uses, so an app cannot use it to declare a shape its manifest would have
// been rejected for.
const interactionSource = readFileSync(
  path.join(repoRoot, 'electron/widget-interaction.ts'),
  'utf8',
)
assert.match(
  interactionSource,
  /parseWidgetShape/,
  'WIDGET_SET_REGIONS must validate through the manifest shape parser',
)

// Hit-testing measures the rectangle the app paints into. Window bounds and
// content bounds differ on Windows by the invisible resize border, and mixing
// them shifts every declared region.
const windowSource = readFileSync(path.join(repoRoot, 'electron/widget-window.ts'), 'utf8')
assert.match(
  windowSource,
  /shouldIgnoreMouse\(\s*\n?\s*window\.getContentBounds\(\)/,
  'the hit-test loop must measure getContentBounds, not getBounds',
)

// The widget window and the main window must agree about when to load the
// built renderer. If only one of them honours QORTIUM_HOME_LOAD_DIST, an
// unpackaged run shows a Home window with a blank widget or the reverse.
for (const [label, source] of [
  ['electron/main.ts', readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8')],
  ['electron/widget-window.ts', windowSource],
] as const) {
  assert.match(
    source,
    /shouldLoadRendererFromDist\(\)/,
    `${label} must decide its renderer entry through shouldLoadRendererFromDist`,
  )
  assert.ok(
    !/if \(app\.isPackaged\) \{\s*\n\s*void (window|this)\.load/.test(source),
    `${label} must not branch on app.isPackaged directly when loading the renderer`,
  )
}

// WebContentsView defaults to an opaque white background independent of its
// host BrowserWindow's own background, so a transparent widget window still
// showed a solid white rectangle everywhere the app itself did not paint
// over it. Both layers must opt into a transparent background, and only for
// widget views/windows - giving every QDN view a transparent background
// would let ordinary app tabs that don't paint their own background show
// the Home interface underneath them.
assert.match(
  viewsSource,
  /tabId\.startsWith\(['"]widget:['"]\)/,
  'only widget QDN views should opt into transparent compositing',
)
assert.match(
  viewsSource,
  /\.setBackgroundColor\(['"]#00000000['"]\)/,
  'widget WebContentsView must have a fully transparent native background',
)
assert.match(
  windowSource,
  /backgroundColor:\s*['"]#00000000['"]/,
  'widget BrowserWindow must set an explicit transparent backgroundColor; transparent: true alone is not enough',
)

console.log('widget-shell-contract tests passed')
