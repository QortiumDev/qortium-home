import assert from 'node:assert/strict';
import {
  isQdnFileNotFoundResponse,
  QDN_FILE_NOT_FOUND_ERROR,
  QdnFileNotFoundError,
} from './qdn-file-not-found.js';

assert.equal(QDN_FILE_NOT_FOUND_ERROR, 1401);
assert.equal(
  isQdnFileNotFoundResponse(
    404,
    '{"error":1401,"message":"No file exists at filepath: favicon.ico"}',
  ),
  true,
);
assert.equal(
  isQdnFileNotFoundResponse(404, {
    error: '1401',
    message: 'No file exists at filepath: favicon.ico',
  }),
  true,
);
assert.equal(
  isQdnFileNotFoundResponse(500, { error: 1401 }),
  false,
  'The Core error code is quiet only when paired with its expected HTTP status.',
);
assert.equal(
  isQdnFileNotFoundResponse(404, { error: 1402 }),
  false,
  'Other QDN not-found errors must remain observable.',
);
assert.equal(isQdnFileNotFoundResponse(404, '<html>Not found</html>'), false);

const error = new QdnFileNotFoundError('favicon.ico is absent');
assert.equal(error.name, 'QdnFileNotFoundError');
assert.equal(error.message, 'favicon.ico is absent');

console.log('QDN optional file-not-found detection tests passed.');
