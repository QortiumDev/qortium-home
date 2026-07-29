import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { MAX_NODE_ERROR_BODY_LENGTH, isMarkupErrorBody, readableNodeErrorMessage } from './node-error-body.js';

const FALLBACK = 'Update name transaction build failed.';

// Core's own error shapes are worth showing, so they must survive unchanged.
assert.equal(
  readableNodeErrorMessage('{"error":312,"message":"transaction invalid: name does not exist"}', FALLBACK),
  '{"error":312,"message":"transaction invalid: name does not exist"}',
);
assert.equal(readableNodeErrorMessage('Bad parameter "name"', FALLBACK), 'Bad parameter "name"');
assert.equal(readableNodeErrorMessage('  Bad parameter "name"  \n', FALLBACK), 'Bad parameter "name"');

// An empty body has nothing to say; the caller's message is better.
assert.equal(readableNodeErrorMessage('', FALLBACK), FALLBACK);
assert.equal(readableNodeErrorMessage('   \n\t ', FALLBACK), FALLBACK);

// Markup must never reach a Q-App's error UI. This is the Jetty 500 page Core
// serves when ApiExceptionMapper falls through — see qortium-core#148.
const jettyErrorPage = `<html>
<head>
<meta http-equiv="Content-Type" content="text/html;charset=ISO-8859-1"/>
<title>Error 500 Internal Server Error</title>
</head>
<body><h2>HTTP ERROR 500 Internal Server Error</h2>
</body>
</html>`;
assert.equal(readableNodeErrorMessage(jettyErrorPage, FALLBACK), FALLBACK);
assert.equal(readableNodeErrorMessage('<!DOCTYPE html><html><body>nope</body></html>', FALLBACK), FALLBACK);
assert.equal(readableNodeErrorMessage('<?xml version="1.0"?><fault/>', FALLBACK), FALLBACK);
assert.equal(readableNodeErrorMessage('\n\n  <html><body>proxy error</body></html>', FALLBACK), FALLBACK);

// A body long enough to be a document is not a message either.
assert.equal(readableNodeErrorMessage('x'.repeat(MAX_NODE_ERROR_BODY_LENGTH), FALLBACK), 'x'.repeat(MAX_NODE_ERROR_BODY_LENGTH));
assert.equal(readableNodeErrorMessage('x'.repeat(MAX_NODE_ERROR_BODY_LENGTH + 1), FALLBACK), FALLBACK);

// A JSON body that merely mentions a tag is still a message, not markup.
assert.equal(
  readableNodeErrorMessage('{"message":"unexpected <html> in payload"}', FALLBACK),
  '{"message":"unexpected <html> in payload"}',
);

// A leading `<` alone is not markup: a node message may legitimately start with
// one, and losing it to the generic fallback would hide the real reason.
assert.equal(
  readableNodeErrorMessage('<name> is already registered', FALLBACK),
  '<name> is already registered',
);

assert.equal(isMarkupErrorBody('<html><body>x</body></html>'), true);
assert.equal(isMarkupErrorBody('  <!DOCTYPE html>'), true);
assert.equal(isMarkupErrorBody('<?xml version="1.0"?>'), true);
assert.equal(isMarkupErrorBody('<h2>HTTP ERROR 500</h2>'), true);
assert.equal(isMarkupErrorBody('<name> is already registered'), false);
assert.equal(isMarkupErrorBody('{"error":1}'), false);
assert.equal(isMarkupErrorBody('Bad parameter'), false);

// Core's transaction-build endpoints all take a concrete *TransactionData
// subclass, so the "type" field in a request body is redundant. It is also
// actively harmful: 20 of those subclasses are missing MOXy's
// @XmlDiscriminatorValue, so sending "type" makes the node fail to unmarshal
// the body and return a bare HTML 500 (qortium-core#148). Six shipped actions
// were dead this way. Keep every build body free of it.
// Both transports build these bodies independently: electron/qdn.ts on desktop
// and src/platform.ts on Android/Capacitor. Fixing only one leaves the other
// broken, so both are scanned.
// Compiled tests run from dist-electron/, the sources live in electron/ and src/.
function readRepoSource(...candidates: string[]) {
  const url = candidates.map((candidate) => new URL(candidate, import.meta.url)).find((each) => existsSync(each));
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`);
  return readFileSync(url, 'utf8');
}

const qdnSource = readRepoSource('../electron/qdn.ts', './qdn.ts').split('\n');
const platformSource = readRepoSource('../src/platform.ts', './platform.ts').split('\n');

// Scan by transaction-type NAME rather than by proximity to a
// postLocalNodeText( call. A window-based scan has blind spots a future edit
// can fall into for free -- a single-line call, or a body long enough to push
// "type" past the window -- and a guard with blind spots is worse than none,
// because it reads as coverage. Every name below is a Core TransactionType, so
// `type: '<name>'` in these files can only ever be a request body.
const TRANSACTION_TYPES = [
  'ADD_GROUP_ADMIN', 'AT', 'BUY_ASSET_OWNERSHIP', 'BUY_NAME', 'CANCEL_ASSET_ORDER', 'CANCEL_GROUP_BAN',
  'CANCEL_GROUP_INVITE', 'CANCEL_SELL_ASSET_OWNERSHIP', 'CANCEL_SELL_NAME', 'CHAT', 'CREATE_ASSET_ORDER',
  'CREATE_GROUP', 'CREATE_POLL', 'DEPLOY_AT', 'GROUP_APPROVAL', 'GROUP_BAN', 'GROUP_INVITE', 'GROUP_KICK',
  'ISSUE_ASSET', 'JOIN_GROUP', 'LEAVE_GROUP', 'MESSAGE', 'MULTI_PAYMENT', 'PAYMENT', 'PRESENCE', 'PUBLICIZE',
  'RATE_ACCOUNT', 'RATE_RESOURCE', 'REGISTER_NAME', 'REMOVE_GROUP_ADMIN', 'REWARD_SHARE', 'SELL_ASSET_OWNERSHIP',
  'SELL_NAME', 'SET_GROUP', 'TRANSFER_ASSET', 'TRANSFER_PRIVS', 'UPDATE_ASSET', 'UPDATE_GROUP', 'UPDATE_NAME',
  'UPDATE_POLL', 'VOTE_ON_POLL',
];
const TRANSACTION_TYPE_FIELD = new RegExp(`type: '(${TRANSACTION_TYPES.join('|')})'`, 'g');

function findTransactionTypeFields(source: string[]) {
  return source.flatMap((line, index) =>
    [...line.matchAll(TRANSACTION_TYPE_FIELD)].map(([match]) => `${index + 1}: ${match}`),
  );
}

for (const [name, source] of [
  ['electron/qdn.ts', qdnSource],
  ['src/platform.ts', platformSource],
] as const) {
  const found = findTransactionTypeFields(source);
  assert.deepEqual(
    found,
    [],
    `${name} transaction build bodies must not send a "type" field (qortium-core#148):\n  ${found.join('\n  ')}`,
  );
}

// The scan is only meaningful if it can fail, so prove it catches both a
// conventional multi-line body and the single-line form a window-based scan
// would have missed.
assert.deepEqual(
  findTransactionTypeFields(['    JSON.stringify({', "      type: 'UPDATE_NAME',", '    }),']),
  ["2: type: 'UPDATE_NAME'"],
  'the build-body scan must detect a planted type field',
);
assert.deepEqual(
  findTransactionTypeFields([`await postLocalNodeText(c, '/names/update', JSON.stringify({ type: 'UPDATE_NAME', name }), k, m);`]),
  ["1: type: 'UPDATE_NAME'"],
  'the build-body scan must detect a single-line planted type field',
);

// A guard nobody calls is decoration. Pin every raw-body path to the helper so
// a future edit cannot quietly reintroduce `<body> || fallbackMessage`.
// Matches the pattern this change removes: a node response body used as the
// error message with the caller's message demoted to an empty-body fallback.
// Deliberately not anchored to `throw new Error(` -- two of these paths throw
// QdnUploadPostError instead -- and it must tolerate a `.trim()` in between,
// which is how the original code at both qdn.ts sites was written.
const RAW_BODY_FALLBACK = /\b(message|body|responseBody|text|result\.body|result\.text)(\.trim\(\))? \|\| (fallbackMessage|`)/;
const HELPER_CALL = /readableNodeErrorMessage\(/g;

for (const [name, source, expectedCalls, enforceRawBodyGuard] of [
  ['electron/qdn.ts', qdnSource.join('\n'), 17, true],
  ['src/platform.ts', platformSource.join('\n'), 18, true],
  // core-manager also fetches GitHub archives and sends the local stop request.
  // Those non-update paths retain their own bounded/plain-text behavior, so
  // pin the two /admin/update helper calls without applying the Q-App-wide raw
  // body scan to the entire manager.
  ['electron/core-manager.ts', readRepoSource('../electron/core-manager.ts', './core-manager.ts'), 2, false],
  ['electron/node-settings.ts', readRepoSource('../electron/node-settings.ts', './node-settings.ts'), 2, true],
  ['src/QdnViewer.tsx', readRepoSource('../src/QdnViewer.tsx', './QdnViewer.tsx'), 1, true],
] as const) {
  if (enforceRawBodyGuard) {
    assert.ok(
      !RAW_BODY_FALLBACK.test(source),
      `${name} must route every failed node response through readableNodeErrorMessage, not a raw body`,
    );
  }

  assert.equal(
    (source.match(HELPER_CALL) ?? []).length,
    expectedCalls,
    `${name} should call readableNodeErrorMessage on all ${expectedCalls} of its node-response failure paths`,
  );
}

console.log('node-error-body tests passed');
