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

assert.equal(isMarkupErrorBody('<html>'), true);
assert.equal(isMarkupErrorBody('  <!DOCTYPE html>'), true);
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

const BUILD_CALL = /postLocalNodeText\($/;
const TRANSACTION_TYPE_FIELD = /^\s+type: '[A-Z][A-Z_]*',$/;
const BUILD_BODY_LINES = 25;

function findTransactionTypeFields(source: string[]) {
  const found: string[] = [];

  source.forEach((line, index) => {
    if (!BUILD_CALL.test(line)) return;

    for (let cursor = index + 1; cursor < Math.min(index + 1 + BUILD_BODY_LINES, source.length); cursor += 1) {
      if (TRANSACTION_TYPE_FIELD.test(source[cursor])) {
        found.push(`${cursor + 1}: ${source[cursor].trim()}`);
      }
    }
  });

  return found;
}

const offenders = findTransactionTypeFields(qdnSource);
assert.deepEqual(
  offenders,
  [],
  `electron/qdn.ts transaction build bodies must not send a "type" field (qortium-core#148):\n  ${offenders.join('\n  ')}`,
);

const platformOffenders = findTransactionTypeFields(platformSource);
assert.deepEqual(
  platformOffenders,
  [],
  `src/platform.ts transaction build bodies must not send a "type" field (qortium-core#148):\n  ${platformOffenders.join('\n  ')}`,
);

// The scan is only meaningful if it can fail, so prove it catches a planted body.
const plantedOffenders: string[] = [];
const planted = ['  await postLocalNodeText(', "    '/names/update',", '    JSON.stringify({', "      type: 'UPDATE_NAME',", '    }),'];
planted.forEach((line, index) => {
  if (!BUILD_CALL.test(line)) return;
  for (let cursor = index + 1; cursor < planted.length; cursor += 1) {
    if (TRANSACTION_TYPE_FIELD.test(planted[cursor])) plantedOffenders.push(planted[cursor].trim());
  }
});
assert.deepEqual(plantedOffenders, ["type: 'UPDATE_NAME',"], 'the build-body scan must detect a planted type field');

// A guard nobody calls is decoration. Pin every raw-body path to the helper so
// a future edit cannot quietly reintroduce `<body> || fallbackMessage`.
// Matches the pattern this change removes: a node response body thrown as the
// error message with the caller's message demoted to an empty-body fallback.
const RAW_BODY_FALLBACK = /throw new Error\((message|body|responseBody|text|result\.body|result\.text) \|\|/;
const HELPER_CALL = /readableNodeErrorMessage\(/g;

for (const [name, source, expectedCalls] of [
  ['electron/qdn.ts', qdnSource.join('\n'), 14],
  ['src/platform.ts', platformSource.join('\n'), 14],
  ['electron/node-settings.ts', readRepoSource('../electron/node-settings.ts', './node-settings.ts'), 2],
  ['src/QdnViewer.tsx', readRepoSource('../src/QdnViewer.tsx', './QdnViewer.tsx'), 1],
] as const) {
  assert.ok(
    !RAW_BODY_FALLBACK.test(source),
    `${name} must route every failed node response through readableNodeErrorMessage, not a raw body`,
  );
  assert.equal(
    (source.match(HELPER_CALL) ?? []).length,
    expectedCalls,
    `${name} should call readableNodeErrorMessage on all ${expectedCalls} of its node-response failure paths`,
  );
}

console.log('node-error-body tests passed');
