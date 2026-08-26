import assert from 'node:assert/strict';
import {
  HOME_V2_NOTIFICATION_MANAGER_ACTIONS,
  homeV2NotificationManagerCodedError,
  isHomeV2NotificationManagerAction,
  isHomeV2NotificationManagerStoreAction,
  parseHomeV2NotificationManagerRequest,
  readHomeV2NotificationManagerSummary,
  resolveHomeV2NotificationManagerMutation,
  summarizeHomeV2NotificationManagerStore,
  type HomeV2NotificationManagerInspection,
  type HomeV2NotificationManagerRequest,
} from './home-v2-notification-manager-contract.js';
import type { QdnNotificationStore, StoredQdnNotificationRule } from './notification-rules.js';

const managerApp = 'qdn://APP/Notify/Notify';
const chatApp = 'qdn://APP/Chat/Chat';
const walletApp = 'qdn://APP/Wallet/Wallet';
const createdAt = '2026-08-20T12:00:00.000Z';

// Real checksum-valid Qortal addresses plus one-character-mutated invalid
// siblings, so masking is exercised against actual validation.
const validAddress = 'QT4zHex8JEULmBhYmKd5UhpiNA46T5wUko';
const otherValidAddress = 'QgV4s3xnzLhVBEJxjYAFXaSDrbB4qRHVsx';
const invalidAddress = 'QT4zHex8JEULmBhYmKd5UhpiNA46T5wUkn';

const rule = (
  notificationId: string,
  event: StoredQdnNotificationRule['event'],
  filters: StoredQdnNotificationRule['filters'],
): StoredQdnNotificationRule => ({
  notificationId,
  event,
  filters,
  accountAddress: 'QprivateAccountBinding123456789',
  createdAt,
  title: `Title for ${notificationId}`,
  text: `Text for ${notificationId}`,
  link: 'qdn://APP/Chat/Chat/thread/1',
});

const makeStore = (): QdnNotificationStore => ({
  version: 1,
  revision: 11,
  grants: {
    [chatApp]: { grantedAt: '2026-08-17T12:00:00.000Z' },
    [walletApp]: { grantedAt: '2026-08-18T12:00:00.000Z', muted: true },
  },
  rules: {
    [chatApp]: [
      rule('mentions', 'CHAT_MESSAGE', { involving: [validAddress, invalidAddress, otherValidAddress] }),
      rule('confirmed', 'TRANSACTION_CONFIRMED', { signature: 'Qsignature000000000000000000000000' }),
    ],
    [walletApp]: [
      rule('btc', 'FOREIGN_PAYMENT_RECEIVED', { coin: 'BTC', xpub: 'xpubSECRETWATCHONLYKEY' }),
      rule('paid', 'PAYMENT_RECEIVED', { recipient: invalidAddress }),
    ],
  },
});

const available = (store: QdnNotificationStore): HomeV2NotificationManagerInspection =>
  ({ status: 'available', store });

type MutateRequest = Extract<HomeV2NotificationManagerRequest, { kind: 'mutate' }>;

/** Narrows a parsed request to its mutating variant for the store assertions. */
function mutation(request: HomeV2NotificationManagerRequest): MutateRequest {
  assert.equal(request.kind, 'mutate');
  return request as MutateRequest;
}

// ---------------------------------------------------------------------------
// The surface is exactly the 1.x five.
// ---------------------------------------------------------------------------

assert.deepEqual([...HOME_V2_NOTIFICATION_MANAGER_ACTIONS], [
  'NOTIFICATION_MANAGER_HAS_PERMISSION',
  'NOTIFICATION_MANAGER_GET',
  'NOTIFICATION_MANAGER_SET_MUTED',
  'NOTIFICATION_MANAGER_REMOVE_RULES',
  'NOTIFICATION_MANAGER_REVOKE',
]);
assert.equal(isHomeV2NotificationManagerAction('NOTIFICATION_MANAGER_GET'), true);
// Rule CREATION is deliberately not part of this surface.
for (const absent of ['NOTIFICATION_ADD', 'NOTIFICATION_GET', 'NOTIFICATION_REMOVE', 'SHOW_NOTIFICATION']) {
  assert.equal(isHomeV2NotificationManagerAction(absent), false, `${absent} must not be a manager action`);
}
assert.equal(isHomeV2NotificationManagerStoreAction('NOTIFICATION_MANAGER_HAS_PERMISSION'), false);
assert.equal(isHomeV2NotificationManagerStoreAction('NOTIFICATION_MANAGER_GET'), true);

// ---------------------------------------------------------------------------
// Summary shape: exactly what Notify's isNotificationManagerSummary accepts.
// (qortium-notify/src/notificationManager.ts:63-71)
// ---------------------------------------------------------------------------

const summary = readHomeV2NotificationManagerSummary(available(makeStore()));
assert.equal(summary.version, 1);
assert.equal(summary.revision, 11);
assert.ok(Array.isArray(summary.apps));
assert.deepEqual(summary.apps.map((app) => app.appKey), [chatApp, walletApp], 'apps are sorted by appKey');
assert.deepEqual(Object.keys(summary).sort(), ['apps', 'revision', 'version']);

// Notify's own validator, transcribed. If the summary ever stops satisfying
// this the shipped app throws "Home returned an unexpected notification
// manager summary." and every manager screen goes blank.
function isNotificationManagerSummary(value: unknown) {
  return (
    !!value && typeof value === 'object' && !Array.isArray(value) &&
    (value as Record<string, unknown>).version === 1 &&
    Number.isSafeInteger((value as Record<string, unknown>).revision) &&
    ((value as Record<string, unknown>).revision as number) >= 0 &&
    Array.isArray((value as Record<string, unknown>).apps)
  );
}
assert.equal(isNotificationManagerSummary(summary), true);

const chatSummary = summary.apps.find((app) => app.appKey === chatApp)!;
const walletSummary = summary.apps.find((app) => app.appKey === walletApp)!;
assert.deepEqual(chatSummary.grant, { grantedAt: '2026-08-17T12:00:00.000Z' });
assert.deepEqual(walletSummary.grant, { grantedAt: '2026-08-18T12:00:00.000Z', muted: true });

// ---------------------------------------------------------------------------
// Masking contract, including partiallyMaskedFilterKeys.
// ---------------------------------------------------------------------------

const mentions = chatSummary.rules.find((each) => each.notificationId === 'mentions')!;
assert.deepEqual(
  mentions.filters.involving,
  [validAddress, otherValidAddress],
  'a mixed address array keeps only the addresses that validate',
);
assert.deepEqual(mentions.partiallyMaskedFilterKeys, ['involving']);
assert.deepEqual(mentions.maskedFilterKeys, []);

const confirmed = chatSummary.rules.find((each) => each.notificationId === 'confirmed')!;
assert.equal(Object.hasOwn(confirmed.filters, 'signature'), false, 'signature is always fully masked');
assert.deepEqual(confirmed.maskedFilterKeys, ['signature']);
assert.deepEqual(confirmed.partiallyMaskedFilterKeys, []);

const btc = walletSummary.rules.find((each) => each.notificationId === 'btc')!;
assert.equal(Object.hasOwn(btc.filters, 'xpub'), false, 'a foreign-payment watch-only key never reaches the manager');
assert.deepEqual(btc.maskedFilterKeys, ['xpub']);
assert.equal(btc.filters.coin, 'BTC');

const paid = walletSummary.rules.find((each) => each.notificationId === 'paid')!;
assert.equal(Object.hasOwn(paid.filters, 'recipient'), false, 'an invalid address-like value is masked, not exposed');
assert.deepEqual(paid.maskedFilterKeys, ['recipient']);

// The per-rule account binding never crosses the bridge.
for (const app of summary.apps) {
  for (const each of app.rules) {
    assert.equal(Object.hasOwn(each as object, 'accountAddress'), false, 'rule summaries never carry the account binding');
  }
}

// ---------------------------------------------------------------------------
// Request parsing: each mutation, and exact-key rejections.
// ---------------------------------------------------------------------------

const hasPermission = parseHomeV2NotificationManagerRequest(
  'NOTIFICATION_MANAGER_HAS_PERMISSION',
  { action: 'NOTIFICATION_MANAGER_HAS_PERMISSION' },
);
assert.equal(hasPermission.kind, 'has-permission');

const get = parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_GET', { action: 'NOTIFICATION_MANAGER_GET' });
assert.equal(get.kind, 'get');

const muteRequest = parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_SET_MUTED', {
  action: 'NOTIFICATION_MANAGER_SET_MUTED',
  appKey: chatApp,
  expectedRevision: 11,
  muted: true,
});
assert.equal(muteRequest.kind, 'mutate');
assert.deepEqual(
  muteRequest.kind === 'mutate' ? muteRequest.mutation : null,
  { type: 'SET_APP_MUTED', appKey: chatApp, muted: true },
);

const removeRequest = parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_REMOVE_RULES', {
  action: 'NOTIFICATION_MANAGER_REMOVE_RULES',
  appKey: chatApp,
  expectedRevision: 11,
  notificationIds: ['mentions', 'mentions'],
});
assert.deepEqual(
  removeRequest.kind === 'mutate' ? removeRequest.mutation : null,
  { type: 'REMOVE_APP_RULES', appKey: chatApp, notificationIds: ['mentions'] },
  'duplicate notification ids collapse',
);

const revokeRequest = parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_REVOKE', {
  action: 'NOTIFICATION_MANAGER_REVOKE',
  appKey: chatApp,
  expectedRevision: 11,
});
assert.deepEqual(
  revokeRequest.kind === 'mutate' ? revokeRequest.mutation : null,
  { type: 'REVOKE_APP', appKey: chatApp },
);

// An unknown field is refused rather than ignored.
assert.throws(
  () => parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_REVOKE', {
    action: 'NOTIFICATION_MANAGER_REVOKE',
    appKey: chatApp,
    expectedRevision: 11,
    alsoDeleteRules: true,
  }),
  /does not support the field alsoDeleteRules/,
);
assert.throws(
  () => parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_GET', {
    action: 'NOTIFICATION_MANAGER_GET',
    appKey: chatApp,
  }),
  /does not support the field appKey/,
);
// A request that names a different action cannot be smuggled through a
// dispatch that already decided which action it is.
assert.throws(
  () => parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_GET', {
    action: 'NOTIFICATION_MANAGER_REVOKE',
  }),
  /named a different action/,
);
// Both hosts normalize the dispatched action name before parsing, so a caller
// that sent a lowercase action — which 1.x accepted — must not be rejected for
// disagreeing with its own normalized name.
assert.equal(
  parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_GET', {
    action: 'notification_manager_get',
  }).kind,
  'get',
);
// A non-string action field is still refused.
assert.throws(
  () => parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_GET', { action: 7 }),
  /named a different action/,
);
// Missing required fields.
assert.throws(
  () => parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_SET_MUTED', {
    action: 'NOTIFICATION_MANAGER_SET_MUTED',
    appKey: chatApp,
    muted: true,
  }),
  /requires expectedRevision/,
);
for (const badRevision of [-1, 1.5, '11', null, Number.MAX_SAFE_INTEGER + 2]) {
  assert.throws(
    () => parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_REVOKE', {
      action: 'NOTIFICATION_MANAGER_REVOKE',
      appKey: chatApp,
      expectedRevision: badRevision,
    }),
    /non-negative safe integer/,
    `expectedRevision ${String(badRevision)} must be refused`,
  );
}
// App keys are validated by the same sanitizer 1.x used.
for (const badAppKey of ['__proto__', 'https://example.invalid/app', '', 'qdn://APP', chatApp.repeat(200)]) {
  assert.throws(
    () => parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_REVOKE', {
      action: 'NOTIFICATION_MANAGER_REVOKE',
      appKey: badAppKey,
      expectedRevision: 11,
    }),
    `app key ${badAppKey.slice(0, 24)} must be refused`,
  );
}
assert.throws(
  () => parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_REMOVE_RULES', {
    action: 'NOTIFICATION_MANAGER_REMOVE_RULES',
    appKey: chatApp,
    expectedRevision: 11,
    notificationIds: [],
  }),
  /at least one notification id/,
);
assert.throws(
  () => parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_SET_MUTED', {
    action: 'NOTIFICATION_MANAGER_SET_MUTED',
    appKey: chatApp,
    expectedRevision: 11,
    muted: 'yes',
  }),
  /muted state must be a boolean/,
);
assert.throws(
  () => parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_GET', 'not-an-object' as unknown),
  /requires a request object/,
);

// ---------------------------------------------------------------------------
// Mutations applied to the store.
// ---------------------------------------------------------------------------

const muted = resolveHomeV2NotificationManagerMutation(available(makeStore()), mutation(muteRequest));
assert.deepEqual(muted.grants[chatApp], { grantedAt: '2026-08-17T12:00:00.000Z', muted: true });
assert.equal(muted.rules[chatApp].length, 2, 'muting keeps every rule');

const withoutMentions = resolveHomeV2NotificationManagerMutation(available(makeStore()), mutation(removeRequest));
assert.deepEqual(
  withoutMentions.rules[chatApp].map((each) => each.notificationId),
  ['confirmed'],
);
assert.ok(withoutMentions.grants[chatApp], 'removing rules keeps the app permission');

const revoked = resolveHomeV2NotificationManagerMutation(available(makeStore()), mutation(revokeRequest));
assert.equal(revoked.grants[chatApp], undefined);
assert.equal(revoked.rules[chatApp], undefined);
assert.ok(revoked.grants[walletApp], 'revoking one app never touches another');
assert.ok(revoked.rules[walletApp], 'revoking one app never touches another app’s rules');

// Muting an app that holds no grant is refused rather than inventing one.
assert.throws(
  () => resolveHomeV2NotificationManagerMutation(
    available(makeStore()),
    mutation(parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_SET_MUTED', {
      action: 'NOTIFICATION_MANAGER_SET_MUTED',
      appKey: 'qdn://APP/Unknown/Unknown',
      expectedRevision: 11,
      muted: true,
    })),
  ),
  /permission is not granted for this app/,
);

// The manager can act on ITSELF like any other app; nothing exempts it. This
// pins that there is no hidden self-protection carve-out to reason about.
const selfStore = makeStore();
selfStore.grants[managerApp] = { grantedAt: createdAt };
const selfRevoked = resolveHomeV2NotificationManagerMutation(
  available(selfStore),
  mutation(parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_REVOKE', {
    action: 'NOTIFICATION_MANAGER_REVOKE',
    appKey: managerApp,
    expectedRevision: 11,
  })),
);
assert.equal(selfRevoked.grants[managerApp], undefined);

// ---------------------------------------------------------------------------
// Compare-and-set: a mismatch is HOME_DATA_STALE, and the code survives.
// ---------------------------------------------------------------------------

const staleRequest = parseHomeV2NotificationManagerRequest('NOTIFICATION_MANAGER_REVOKE', {
  action: 'NOTIFICATION_MANAGER_REVOKE',
  appKey: chatApp,
  expectedRevision: 10,
});
assert.throws(
  () => resolveHomeV2NotificationManagerMutation(available(makeStore()), mutation(staleRequest)),
  (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as { code?: unknown }).code, 'HOME_DATA_STALE');
    return true;
  },
);

// The preload copies every non-`message` field of the error envelope onto the
// rejection the app sees (electron/home-v2-qdn-app-preload.cts:14-20). This
// reproduces that projection so the contract is pinned end to end: Notify's
// isStaleRevisionError reads exactly this `code`.
function bridgeErrorPayload(error: unknown) {
  const record = error as Record<string, unknown>;
  return {
    message: error instanceof Error ? error.message : String(error),
    ...(typeof record.code === 'string' ? { code: record.code } : {}),
  };
}
function rethrowThroughPreload(payload: Record<string, unknown>) {
  const { message, ...rest } = payload;
  return Object.assign(new Error(String(message)), rest);
}
let staleThrown: unknown;
try {
  resolveHomeV2NotificationManagerMutation(available(makeStore()), mutation(staleRequest));
} catch (error) {
  staleThrown = error;
}
const delivered = rethrowThroughPreload(bridgeErrorPayload(staleThrown));
assert.equal((delivered as { code?: unknown }).code, 'HOME_DATA_STALE', 'the code must survive the bridge envelope');
assert.match(delivered.message, /refresh and try again/);

// ---------------------------------------------------------------------------
// Fail closed on a degraded store.
// ---------------------------------------------------------------------------

for (const [status, code] of [
  ['corrupt', 'HOME_NOTIFICATION_STORE_CORRUPT'],
  ['unavailable', 'HOME_NOTIFICATION_STORE_UNAVAILABLE'],
] as const) {
  const inspection: HomeV2NotificationManagerInspection = { status, store: null };
  assert.throws(
    () => readHomeV2NotificationManagerSummary(inspection),
    (error: unknown) => {
      assert.equal((error as { code?: unknown }).code, code);
      return true;
    },
    `a ${status} store must not be reported as an empty profile`,
  );
  assert.throws(
    () => resolveHomeV2NotificationManagerMutation(inspection, mutation(revokeRequest)),
    (error: unknown) => {
      assert.equal((error as { code?: unknown }).code, code);
      return true;
    },
    `a ${status} store must not be written over`,
  );
}

// An empty-but-healthy store is NOT an error: "you have granted nothing" is a
// legitimate answer and must stay distinguishable from "I cannot tell".
const empty = readHomeV2NotificationManagerSummary(available({
  version: 1,
  revision: 0,
  grants: {},
  rules: {},
}));
assert.deepEqual(empty, { version: 1, revision: 0, apps: [] });

// ---------------------------------------------------------------------------
// Round trip: the summary of a mutation result is the summary of the store.
// ---------------------------------------------------------------------------

assert.deepEqual(
  summarizeHomeV2NotificationManagerStore(revoked),
  readHomeV2NotificationManagerSummary(available(revoked)),
);

assert.equal((homeV2NotificationManagerCodedError('X', 'y') as { code: string }).code, 'X');

console.log('Home 2 notification manager contract tests passed.');
