// Guards that TRANSFER_ASSET rejects a fractional amount on an indivisible
// asset before requesting write approval, on both transports, and that the
// check runs before the transaction is built (fails fast, no wasted approval
// prompt or wallet unlock for a request that can never succeed).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

function readRepoSource(...candidates: string[]) {
  const url = candidates.map((candidate) => new URL(candidate, import.meta.url)).find((each) => existsSync(each));
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`);
  // Normalize CRLF to LF: this checkout has core.autocrlf=true, so \n}\n
  // below would never match against a raw \r\n}\r\n line ending.
  return readFileSync(url, 'utf8').replace(/\r\n/g, '\n');
}

function readFunction(source: string, name: string) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist.`);
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `${name} must have a closing brace.`);
  return source.slice(start, end);
}

const desktop = readRepoSource('../electron/qdn.ts', './qdn.ts');
const android = readRepoSource('../src/platform.ts', './platform.ts');

for (const [name, source] of [
  ['electron/qdn.ts', desktop],
  ['src/platform.ts', android],
] as const) {
  const body = readFunction(source, 'transferAssetForApp');

  assert(
    body.includes('isDivisible === false'),
    `${name} transferAssetForApp must reject fractional amounts for indivisible assets.`,
  );
  assert(
    body.includes('/^\\d+$/.test(String(amount))'),
    `${name} transferAssetForApp must whole-number-check the amount before building the transaction.`,
  );

  const guardIndex = body.indexOf('isDivisible === false');
  const writeContextIndex = body.search(/getQdn(Chat|Write)Context\(context\)/);

  assert(
    guardIndex !== -1 && writeContextIndex !== -1 && guardIndex < writeContextIndex,
    `${name} must check divisibility before resolving the write context, so a bad amount fails before any approval prompt.`,
  );
}

console.log('TRANSFER_ASSET divisibility guard parity tests passed.');
