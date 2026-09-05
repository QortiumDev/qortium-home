import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as grants from '../dist-electron/home-v2-session-grants.js';
import * as rating from '../dist-electron/home-v2-rating-permissions.js';
import * as ratingActions from '../dist-electron/home-v2-rating-actions.js';
import * as broker from '../dist-electron/home-v2-rating-permission-model.js';

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
    isQdnViewVisible: () => true,
    randomUUID: () => `request-${prompts.length}`,
    setTimeout: () => 0,
    getQdnViewContextForWebContents: () => context,
    sameViewContext: (before, after) => before.accountId === after.accountId && before.tabId === after.tabId && before.resourceUrl === after.resourceUrl,
  };
  vm.createContext(sandbox);
  vm.runInContext(javascript, sandbox);
  const submit = (target = 'key-one:SUBJECT', action = 'RATE_ACCOUNT') => sandbox.requireAccountReadPermission(
    { id: 50 }, { ...context }, 'qdnRequest', action,
    { kind: 'rating', operationLabel: 'Rate account', ratingDetails: [], routeLabel: 'local', target, targetChainLabel: 'Qortium' },
  );
  return { submit, prompts, store, context, node, pending,
    hold: () => { hold = true; },
    decision: value => { nextDecision = value; },
    mismatch: () => { matches = false; },
    onRecheck: fn => { recheck = fn; },
    release: scope => { for (const entry of pending.values()) entry.resolve({ approved: true, scope }); },
  };
}
const session = host();
await session.submit();
session.store.invalidate(10, { kind: 'navigation-changed', tabId: 'tab-a' });
await session.submit('key-two:TRAINER');
await session.submit('key-three:CREATOR');
assert.equal(session.prompts.length, 1, 'one session approval covers later accounts and roles after internal navigation');
assert.equal(session.prompts[0].writeSingleRequestOnly, false);
await session.submit('resource:APP/Other', 'RATE_RESOURCE');
assert.equal(session.prompts.length, 2, 'resource ratings still prompt');
assert.equal(session.prompts[1].writeSingleRequestOnly, true);
for (const invalidation of [
  { kind: 'locked' }, { kind: 'account-changed' },
  { kind: 'node-changed', network: 'qortium' }, { kind: 'tab-closed', tabId: 'tab-a' },
  { kind: 'app-replaced', tabId: 'tab-a' },
]) {
  const h = host(); await h.submit(); h.store.invalidate(10, invalidation); await h.submit('other');
  assert.equal(h.prompts.length, 2, JSON.stringify(invalidation));
}
for (const field of ['accountId', 'resourceUrl', 'tabId']) {
  const h = host(); await h.submit(); h.context[field] += '-changed'; await h.submit('other');
  assert.equal(h.prompts.length, 2, `${field} must isolate authority`);
}
const route = host(); await route.submit(); route.node.nodeApiUrl += '/changed'; await route.submit();
assert.equal(route.prompts.length, 2, 'route is part of the binding even without invalidation');
const once = host('single-request'); await once.submit(); await once.submit('other');
assert.equal(once.prompts.length, 2); assert.equal(once.store.size(), 0);
const denied = host(); denied.decision({ approved: false, scope: null });
await assert.rejects(denied.submit(), /denied/); assert.equal(denied.store.size(), 0);
denied.decision({ approved: true, scope: 'session' }); await denied.submit(); assert.equal(denied.prompts.length, 2);
const forged = host('always'); await assert.rejects(forged.submit(), /single-request or session/); assert.equal(forged.store.size(), 0);
const concurrent = host(); concurrent.hold();
const first = concurrent.submit(); const second = concurrent.submit('other');
await new Promise(resolve => setImmediate(resolve));
assert.equal(concurrent.prompts.length, 2, 'two in-flight requests do not share an Allow once decision');
concurrent.release('single-request'); await Promise.all([first, second]); assert.equal(concurrent.store.size(), 0);
const stale = host(); stale.hold(); const waiting = stale.submit();
await new Promise(resolve => setImmediate(resolve)); stale.mismatch(); stale.release('session');
await assert.rejects(waiting, /context changed/); assert.equal(stale.store.size(), 0);

// A lifecycle round trip during an asynchronous post-consent recheck cannot
// resurrect a session that was already invalidated.
for (const invalidation of [{ kind: 'locked' }, { kind: 'account-changed' }, { kind: 'node-changed', network: 'qortium' }]) {
  const h = host();
  h.onRecheck(async () => { h.store.invalidate(10, invalidation); });
  await assert.rejects(h.submit(), /session changed/);
  assert.equal(h.store.size(), 0);
}
const captureStore = grants.createHomeV2SessionGrantStore();
const stillCurrent = captureStore.capture({ family: 'account.rating', hostWebContentsId: 10, network: 'qortium', tabId: 'a' });
captureStore.invalidate(11, { kind: 'locked' });
captureStore.invalidate(10, { kind: 'tab-closed', tabId: 'other' });
assert.equal(stillCurrent(), true);
captureStore.clear(); assert.equal(stillCurrent(), false);

// The shared renderer broker must display/accept session consent, retain it
// through internal navigation, and discard it at the same lifecycle boundaries.
const prompt = broker.createPermissionPrompt({
  id: 'rating-1', protocol: 'qdnRequest', action: 'RATE_ACCOUNT', capability: 'rating.write',
  appId: 'trust', appIdentityKey: 'qdn://APP/Trust/Trust', appTitle: 'Trust',
  context: { identityId: 'alice', walletRef: 'wallet-a', tabId: 'tab-a', nodeProfileRef: 'local', targetNetwork: 'qortium' },
  title: 'Allow rate account?', summary: rating.homeV2RatingPermissionSummary('Trust', 'RATE_ACCOUNT'),
  details: [{ label: 'Scope', value: rating.homeV2RatingPermissionScopeDetail('RATE_ACCOUNT') }],
  allowedScopes: rating.homeV2RatingPermissionScopes('RATE_ACCOUNT'),
});
const requested = broker.queuePermissionPrompt(broker.createPermissionState(), prompt);
assert.throws(() => broker.resolvePermissionPrompt(requested, prompt.id, { approved: true, scope: 'always' }), /not available/);
const approved = broker.resolvePermissionPrompt(requested, prompt.id, { approved: true, scope: 'session' }).state;
assert.equal(broker.hasPermissionGrant(broker.invalidatePermissionState(approved, { kind: 'navigation-changed', tabId: 'tab-a' }), prompt), true);
assert.equal(broker.hasPermissionGrant(approved, { ...prompt, action: 'RATE_RESOURCE' }), false);
for (const change of [{ kind: 'locked' }, { kind: 'identity-changed', identityId: 'alice' }, { kind: 'node-changed', network: 'qortium' }, { kind: 'tab-closed', tabId: 'tab-a' }, { kind: 'app-replaced', tabId: 'tab-a' }]) {
  assert.equal(broker.hasPermissionGrant(broker.invalidatePermissionState(approved, change), prompt), false, JSON.stringify(change));
}
assert.match(prompt.summary, /ratings, updates and removals across all roles/);
assert.deepEqual(rating.homeV2RatingPermissionScopes('RATE_RESOURCE'), ['single-request']);
assert.equal(rating.isHomeV2AccountRatingSessionAction('RATE_ACCOUNT', 'qortalRequest', 'rating'), false);
console.log('PASS rating session: real desktop consent function, sequential accounts/roles, once/concurrent/denied/stale/forged decisions, resource isolation, and renderer lifecycle boundaries. No signing or broadcasts.');

// Execute the actual Android rating arm with only platform I/O replaced.
const androidSource = ts.createSourceFile('live.tsx', readFileSync(new URL('../src/home-v2-live/HomeV2LiveApp.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let androidArm;
function findAndroid(node) {
  if (ts.isIfStatement(node) && node.expression.getText(androidSource).includes("isHomeV2RatingAction(action) || action === 'SET_ACCOUNT_AVATAR'")) androidArm = node;
  ts.forEachChild(node, findAndroid);
}
findAndroid(androidSource); assert.ok(androidArm);
const androidJs = ts.transpileModule(`async function runAndroidRating() { ${androidArm.getText(androidSource)} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function androidHost(scope = 'session') {
  const prompts = [], signed = [];
  let current = true, conflictHook = () => {};
  const context = { tabId: 'a', selectedAccountId: 'alice', resourceLocation: 'qdn://APP/Trust/Trust' };
  const account = { id: 'alice', address: 'Qalice', label: 'Alice', walletId: 'wallet-a', isUnlocked: true };
  const node = { mode: 'local', nodeApiUrl: 'http://127.0.0.1:24891', capabilities: { read: true } };
  const store = grants.createHomeV2SessionGrantStore();
  const sandbox = {
    ...grants, ...rating, ...ratingActions,
    isAndroidHost: true, protocol: 'qdnRequest', action: 'RATE_ACCOUNT', context,
    accountCatalogueRef: { current: { accounts: [account] } },
    productStateRef: { current: { tabs: [{ id: 'a', context: { resourceLocation: context.resourceLocation, identityId: 'home-v2:identity:alice' } }] } },
    nodeClient: { getSnapshot: async () => ({ qortium: node }), requestApp: async () => ({ activeRating: null, canChangeNow: true, blocksRemaining: 0 }) },
    vaultClient: {
      getSigningPublicKey: async () => 'rater-key', deriveAddressFromPublicKey: async key => `Q${key}`,
      signRatingWrite: async input => { assert.equal(await input.isStillValid(), true); signed.push(input); return { accepted: true }; },
    },
    parseHomeV2NodesSnapshot: value => value, isRecord: value => !!value && typeof value === 'object',
    unwrapAndroidNodeRecord: value => value, resolveAppIdentity: () => ({ identityKey: context.resourceLocation, title: 'Trust' }),
    brand: value => value, snapshot: { nodes: { qortium: { ref: 'local' } } },
    createPermissionPrompt: broker.createPermissionPrompt,
    queueBoundPermissionPrompt: async prompt => { prompts.push(prompt); return { approved: scope !== null, scope }; },
    RATING_DETAIL_SEQUENCES: { RATE_ACCOUNT: [] }, androidSequencedDetails: (_a, _sequence, rows) => rows,
    androidSessionAccountGrants: { current: store },
    androidChatSendRateLimiter: { current: { checkAndRecordSend: () => ({ allowed: true }) } },
    isRequestCurrent: () => current,
    assertRequestCurrent: () => { if (!current) throw new Error('Context changed'); },
    assertNoPendingTransactionConflict: async () => conflictHook(),
    retainUnknownTransaction: value => value,
    crypto: { randomUUID: () => `android-${prompts.length}` },
  };
  vm.createContext(sandbox); vm.runInContext(androidJs, sandbox);
  return { prompts, signed, store,
    invalidateDuringConflict: () => { conflictHook = () => { current = false; store.invalidate('android', { kind: 'locked' }); }; },
    submit: async (target = '11111111111111111111111111111111', category = 'SUBJECT') => {
      sandbox.requestValue = { targetPublicKey: target, category, rating: 4 };
      return sandbox.runAndroidRating();
    },
  };
}
const android = androidHost(); await android.submit();
android.store.invalidate('android', { kind: 'navigation-changed', tabId: 'a' });
await android.submit('11111111111111111111111111111112', 'PLAYER');
await android.submit('11111111111111111111111111111113', 'MANAGER');
assert.equal(android.prompts.length, 1); assert.equal(android.signed.length, 3);
android.store.invalidate('android', { kind: 'locked' }); await android.submit(); assert.equal(android.prompts.length, 2);
const androidOnce = androidHost('single-request'); await androidOnce.submit(); await androidOnce.submit(); assert.equal(androidOnce.prompts.length, 2);
for (const scope of ['always', null]) {
  const h = androidHost(scope); await assert.rejects(h.submit(), /denied/); assert.equal(h.store.size(), 0); assert.equal(h.signed.length, 0);
}
const androidStale = androidHost(); androidStale.invalidateDuringConflict();
await assert.rejects(androidStale.submit(), /Context changed/); assert.equal(androidStale.store.size(), 0); assert.equal(androidStale.signed.length, 0);
console.log('PASS actual Android rating arm: three requests/one session prompt, navigation, expiry, Allow once, denial, forged durable scope, and lifecycle race. Vault signing is mocked; no writes.');
