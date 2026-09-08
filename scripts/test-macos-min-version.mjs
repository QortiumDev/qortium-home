import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = mkdtempSync(path.join(os.tmpdir(), 'home-macos-min-test-'));
function binary(cpu, major, minor) {
  const bytes = Buffer.alloc(56);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(cpu, 4);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(24, 20);
  bytes.writeUInt32LE(0x32, 32);
  bytes.writeUInt32LE(24, 36);
  bytes.writeUInt32LE(1, 40);
  bytes.writeUInt32LE((major << 16) | (minor << 8), 44);
  return bytes;
}
function check(...args) {
  return spawnSync(process.execPath, [path.join(import.meta.dirname, 'verify-macos-min-version.mjs'), directory, ...args], {encoding:'utf8'});
}
try {
  writeFileSync(path.join(directory, 'intel'), binary(0x01000007, 10, 15));
  writeFileSync(path.join(directory, 'arm'), binary(0x0100000c, 11, 0));
  assert.equal(check('10.15.0', '--arch=x86_64').status, 0, 'Intel Catalina passes alongside the inert arm64 helper');
  assert.notEqual(check('10.15.0').status, 0, 'Default still checks every architecture');
  assert.equal(check('11.0.0').status, 0);
  assert.notEqual(check('11.0.0', '--arch=unknown').status, 0);
  writeFileSync(path.join(directory, 'intel'), binary(0x01000007, 11, 0));
  assert.notEqual(check('10.15.0', '--arch=x86_64').status, 0, 'An Intel binary requiring a newer OS must fail');
  console.log('Mach-O architecture and minimum-version regression checks passed.');
} finally {
  rmSync(directory, {recursive:true, force:true});
}
