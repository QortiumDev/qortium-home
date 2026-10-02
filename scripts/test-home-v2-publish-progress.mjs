import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as grants from '../dist-electron/home-v2-session-grants.js';
import * as rating from '../dist-electron/home-v2-rating-permissions.js';
import * as ratingActions from '../dist-electron/home-v2-rating-actions.js';
import { createHomeV2PublishProgress } from '../dist-electron/home-v2-publish-progress.js';

// Exercise the production Electron consent function with host I/O replaced.
// Extract its AST declaration, not a duplicate implementation of its policy.
const source = ts.createSourceFile('bridge.ts', readFileSync(new URL('../electron/home-v2-app-bridge.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'requireAccountReadPermission');
assert.ok(declaration);
const javascript = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function host(scope = 'session') {
  const store = grants.createHomeV2SessionGrantStore();
  const prompts = [];
  const pending = new Map();
  const context = { accountId: 'alice', resourceUrl: 'qdn://APP/Trust/Trust', tabId: 'tab-a', windowId: 10 };
  let nextDecision = { approved: true, scope };
  let hold = false;
  let matches = true;
  let recheck = null;
  const node = { mode: 'local', nodeApiUrl: 'http://127.0.0.1:24891' };
  const window = { isDestroyed: () => false, webContents: { id: 10, send: (_channel, payload) => {
    prompts.push(payload);
    if (!hold) pending.get(payload.requestId).resolve(nextDecision);
  } } };
  const sandbox = {
    ...grants, ...rating,
    sessionAccountReadGrants: store, pendingSessionGrantDecisions: new Map(), pendingAccountReads: pending,
    liveResourceMatchesGrant: () => matches,
    getHomeV2ReadableNode: async () => { if (prompts.length && recheck) await recheck(); return node; },
    isAccountUnlocked: () => true,
    hasQdnAccountCapability: () => false,
    getContextWindow: () => window,
    // Window raising/flashing before a prompt is WM behaviour, not this test's subject.
    bringPromptToAttention: () => undefined,
    isQdnViewVisible: () => true,
    randomUUID: () => `request-${prompts.length}`,
    setTimeout: () => 0,
    getQdnViewContextForWebContents: () => context,
    sameViewContext: (before, after) => before.accountId === after.accountId && before.tabId === after.tabId && before.resourceUrl === after.resourceUrl,
  };
  vm.createContext(sandbox);
  vm.runInContext(javascript, sandbox);
  const submit = (progress, action = 'PUBLISH_QDN_RESOURCE') => sandbox.requireAccountReadPermission(
    { id: 50 }, { ...context }, 'qdnRequest', action,
    { kind: 'publish', publisherName: 'alice', operationLabel: 'Publish attachment',
      fileName: 'photo.png', size: 10, contentHash: 'hash', resourceCoordinate: 'IMAGE/alice/test',
      routeLabel: 'local', targetChainLabel: 'Qortium' }, progress,
  );
  return { submit, prompts, store, context, node, pending,
    hold: () => { hold = true; },
    decision: value => { nextDecision = value; },
    mismatch: () => { matches = false; },
    onRecheck: fn => { recheck = fn; },
    release: scope => { for (const entry of pending.values()) entry.resolve({ approved: true, scope }); },
  };
}

for (const action of ['PUBLISH_QDN_RESOURCE', 'PUBLISH_CHAT_ATTACHMENT']) {
  const h = host('single-request'); h.hold();
  const phases = [];
  const pending = h.submit(phase => phases.push(phase), action);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(phases, ['approval']);
  assert.equal(h.prompts.length, 1);
  // Hold the post-approval node recheck: Chat must stop asking for approval
  // immediately, before any remaining host work has finished.
  let releaseRecheck;
  h.onRecheck(() => new Promise(resolve => { releaseRecheck = resolve; }));
  h.release('single-request');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(phases, ['approval', 'publishing']);
  releaseRecheck(); await pending;
  const denied = host(null); denied.decision({ approved: false, scope: null });
  const deniedPhases = [];
  await assert.rejects(denied.submit(phase => deniedPhases.push(phase), action), /denied/);
  assert.deepEqual(deniedPhases, ['approval']);
}
const session = host('session');
await session.submit(() => {});
const skipped = [];
await session.submit(phase => skipped.push(phase));
assert.deepEqual(skipped, [], 'an existing grant must not report a prompt');
assert.equal(session.prompts.length, 1);

const sent = [];
let current = true;
const request = { action: 'PUBLISH_CHAT_ATTACHMENT', progressId: 'request-1', secret: 'never forwarded' };
const report = createHomeV2PublishProgress('qdnRequest', request, value => sent.push(value), () => current);
report('preparing'); report('approval'); report('publishing'); report('approval'); report('publishing');
assert.deepEqual(sent.map(value => value.phase), ['preparing', 'approval', 'publishing']);
assert.deepEqual(Object.keys(sent[0]).sort(), ['action', 'phase', 'progressId', 'protocol', 'type']);
current = false;
createHomeV2PublishProgress('qdnRequest', request, value => sent.push(value), () => current)('approval');
for (const invalid of [{...request, progressId: '<script>'}, {...request, action: 'SEND_COIN'}, {...request, action: ' publish_qdn_resource '}, {...request, progressId: undefined}]) {
  createHomeV2PublishProgress('qdnRequest', invalid, value => sent.push(value), () => true)('approval');
}
assert.equal(sent.length, 3);
assert.doesNotThrow(() => createHomeV2PublishProgress('qdnRequest', request, () => { throw Error('closed'); }, () => true)('approval'));

// Exercise the real sandboxed preload body, keeping Electron I/O stubbed.
const preloadPath = new URL('../electron/home-v2-qdn-app-preload.cts', import.meta.url);
const preload = ts.transpileModule(readFileSync(preloadPath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
let listener; const posted = [];
vm.runInNewContext(preload, {
  require: name => { assert.equal(name, 'electron'); return {
    contextBridge: { exposeInMainWorld() {} },
    ipcRenderer: { on(channel, fn) { assert.equal(channel, 'home-v2-app:publish-progress'); listener = fn; } },
  }; },
  window: { location: { origin: 'https://app.example' }, postMessage: (...args) => posted.push(args) },
});
listener({}, sent[1]);
assert.deepEqual(posted, [[sent[1], 'https://app.example']]);
console.log('Publish progress: real consent approval/denial/session skip, post-approval recheck, scoped payload and preload delivery passed.');

// Production desktop IPC handler: the reporter closes with its exact request,
// including exceptional completion, and checks the current view on each emit.
let ipcCallback;
function findIpc(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'ipcMain.handle' &&
    node.arguments[0]?.getText(source) === "'home-v2-app:request'") ipcCallback = node.arguments[1];
  ts.forEachChild(node, findIpc);
}
findIpc(source); assert.ok(ipcCallback);
let liveContext = { accountId: 'alice', tabId: 'a' };
let capturedProgress; let finishRequest;
const ipcMessages = [];
const ipcHandler = vm.runInNewContext(ts.transpileModule(`(${ipcCallback.getText(source)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText, {
  createHomeV2PublishProgress,
  getQdnViewContextForWebContents: () => liveContext,
  sameViewContext: (a, b) => a === b,
  liveResourceMatchesGrant: () => true,
  normalizeHomeV2AppProtocol: value => value,
  encodeQdnBridgeResult: value => value,
  encodeQdnBridgeError: error => ({ error: error.message }),
  handleRequest: (_sender, _context, _protocol, _request, progress) => {
    capturedProgress = progress;
    return new Promise(resolve => { finishRequest = resolve; });
  },
});
const ipcEvent = { sender: {}, senderFrame: { send: (...args) => ipcMessages.push(args) } };
const ipcResult = ipcHandler(ipcEvent, 'qdnRequest', request);
capturedProgress('approval'); assert.equal(ipcMessages.length, 1);
finishRequest(true); await ipcResult;
capturedProgress('publishing'); assert.equal(ipcMessages.length, 1, 'no post-settlement IPC');
const staleIpc = ipcHandler(ipcEvent, 'qdnRequest', request);
liveContext = { accountId: 'bob', tabId: 'a' };
capturedProgress('approval'); assert.equal(ipcMessages.length, 1, 'no stale-context IPC');
finishRequest(true); await staleIpc;

// Execute the actual Android prompt wrappers: admission failures must never
// advertise an approval prompt that was not queued.
const androidSource = ts.createSourceFile('HomeV2LiveApp.tsx', readFileSync(new URL('../src/home-v2-live/HomeV2LiveApp.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
for (const [wrapper, queue] of [['queueBoundPermissionPrompt', 'queueAndroidPermissionPrompt'], ['queueBoundSessionGrantPermission', 'queueAndroidSessionGrantPermission']]) {
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(androidSource) === wrapper) declaration = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(androidSource); assert.ok(declaration);
  const phases = [];
  let refuse = true;
  const fn = vm.runInNewContext(ts.transpileModule(`(${declaration.getText(androidSource)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    assertRequestCurrent() {}, isRequestCurrent: () => true,
    reportPublishProgress: phase => phases.push(phase),
    [queue]: () => { if (refuse) throw Error('prompt cap'); return Promise.resolve({ approved: true }); },
  });
  await assert.rejects(fn(), /prompt cap/); assert.deepEqual(phases, []);
  refuse = false; await fn(); assert.deepEqual(phases, ['approval']);
}
console.log('Production desktop IPC lifetime and Android prompt-admission ordering passed.');
