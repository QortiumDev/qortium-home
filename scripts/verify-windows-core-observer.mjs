#!/usr/bin/env node

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const EXPECTED_SELF_TEST = {
  schema: 'qortium-core-observer',
  schemaVersion: 1,
  platform: 'win32',
  arch: 'x64',
  mode: 'self-test',
  status: 'ok',
};
const MAX_SELF_TEST_BYTES = 64 * 1024;
const PE_X64_MACHINE = 0x8664;

function fail(message) {
  throw new Error(message);
}

function usage() {
  return 'Usage: node scripts/verify-windows-core-observer.mjs (--resources <resources-dir> | --app <win-unpacked-dir>)';
}

function parseResourcesPath(args) {
  if (args.length !== 2 || (args[0] !== '--resources' && args[0] !== '--app') || !args[1]) {
    fail(usage());
  }
  const supplied = path.resolve(args[1]);
  const suppliedStats = lstatSync(supplied);
  if (!suppliedStats.isDirectory() || suppliedStats.isSymbolicLink()) {
    fail(`The supplied unpacked path is not a real directory: ${supplied}`);
  }
  const root = realpathSync(supplied);
  const rootStats = lstatSync(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    fail(`The canonical unpacked path is not a real directory: ${root}`);
  }
  const resources = args[0] === '--resources' ? root : path.join(root, 'resources');
  const resourcesStats = lstatSync(resources);
  if (!resourcesStats.isDirectory() || resourcesStats.isSymbolicLink()) {
    fail(`The unpacked resources path is not a real directory: ${resources}`);
  }
  return realpathSync(resources);
}

function verifySafeFile(binaryPath) {
  const stats = lstatSync(binaryPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail(`Observer is not a regular non-symlink file: ${binaryPath}`);
  }
  if ((stats.mode & 0o7000) !== 0) {
    fail(`Observer has unsafe special mode bits: ${binaryPath}`);
  }
  // Node's Windows mode bits do not represent ACL writability. Apply the
  // stricter POSIX check only on hosts where those bits are meaningful.
  if (typeof process.getuid === 'function' && (stats.mode & 0o022) !== 0) {
    fail(`Observer is writable by group or others: ${binaryPath}`);
  }
}

function readExactly(descriptor, length, position) {
  const output = Buffer.alloc(length);
  let bytes = 0;
  while (bytes < length) {
    const read = readSync(descriptor, output, bytes, length - bytes, position + bytes);
    if (read === 0) fail('Observer has a truncated PE header.');
    bytes += read;
  }
  return output;
}

function verifyPeX64(binaryPath) {
  const descriptor = openSync(binaryPath, constants.O_RDONLY);
  try {
    const fileSize = fstatSync(descriptor).size;
    const dosHeader = readExactly(descriptor, 64, 0);
    if (dosHeader[0] !== 0x4d || dosHeader[1] !== 0x5a) {
      fail('Observer does not have a valid DOS/PE signature.');
    }
    const peOffset = dosHeader.readUInt32LE(0x3c);
    if (peOffset < 64 || peOffset > fileSize - 6) {
      fail(`Observer has an unsafe PE header offset: ${peOffset}`);
    }
    const peHeader = readExactly(descriptor, 6, peOffset);
    if (!peHeader.subarray(0, 4).equals(Buffer.from([0x50, 0x45, 0, 0]))) {
      fail('Observer does not have a valid PE signature.');
    }
    const machine = peHeader.readUInt16LE(4);
    if (machine !== PE_X64_MACHINE) {
      fail(`Observer PE machine is 0x${machine.toString(16)}, expected x64 0x8664.`);
    }
    return machine;
  } finally {
    closeSync(descriptor);
  }
}

function runSelfTest(binaryPath) {
  const result = spawnSync(binaryPath, ['self-test'], {
    encoding: 'utf8',
    maxBuffer: MAX_SELF_TEST_BYTES,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
    windowsHide: true,
  });
  if (result.error) fail(`Observer self-test failed to run: ${result.error.message}`);
  if (result.signal) fail(`Observer self-test ended with signal ${result.signal}.`);
  if (result.status !== 0) {
    fail(`Observer self-test exited with status ${result.status}.`);
  }
  if (result.stderr.length !== 0) fail('Observer self-test wrote unexpected stderr output.');

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    fail('Observer self-test did not return one valid JSON envelope.');
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    fail('Observer self-test envelope is not an object.');
  }
  const actualKeys = Object.keys(parsed).sort();
  const expectedKeys = Object.keys(EXPECTED_SELF_TEST).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    fail(`Observer self-test keys do not match the schema: ${actualKeys.join(', ')}`);
  }
  for (const [key, expected] of Object.entries(EXPECTED_SELF_TEST)) {
    if (parsed[key] !== expected) {
      fail(`Observer self-test ${key} is invalid.`);
    }
  }
}

function main() {
  if (process.platform !== 'win32') {
    fail('The packaged Windows observer must be verified on Windows.');
  }
  const resourcesPath = parseResourcesPath(process.argv.slice(2));
  const packagedBinaryPath = path.join(
    resourcesPath,
    'native',
    'windows',
    'x64',
    'qortium-core-observer.exe',
  );
  const observerDirectory = path.dirname(packagedBinaryPath);
  const packagedEntries = readdirSync(observerDirectory).sort();
  if (JSON.stringify(packagedEntries) !== JSON.stringify(['qortium-core-observer.exe'])) {
    fail(`The packaged observer directory has unexpected content: ${packagedEntries.join(', ')}`);
  }
  verifySafeFile(packagedBinaryPath);
  const binaryPath = realpathSync(packagedBinaryPath);
  verifySafeFile(binaryPath);
  const machine = verifyPeX64(binaryPath);
  runSelfTest(binaryPath);
  console.log(JSON.stringify({
    arch: 'x64',
    binary: binaryPath,
    machine: `0x${machine.toString(16)}`,
    selfTest: 'passed',
  }));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
