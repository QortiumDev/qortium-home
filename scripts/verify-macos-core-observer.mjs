#!/usr/bin/env node

import { accessSync, constants, lstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const appPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const targets = [
  { directory: 'x64', lipoArch: 'x86_64' },
  { directory: 'arm64', lipoArch: 'arm64' },
];

function fail(message) {
  throw new Error(message);
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(result.stderr.trim() || `${command} exited with status ${result.status}`);
  return result.stdout.trim();
}

function verifyBinary(target) {
  const binaryPath = path.join(
    appPath,
    'Contents',
    'Resources',
    'native',
    'macos',
    target.directory,
    'qortium-core-observer',
  );
  accessSync(binaryPath, constants.R_OK | constants.X_OK);
  const stats = lstatSync(binaryPath);
  const effectiveUid = process.geteuid?.();
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o755 ||
    (stats.mode & 0o7000) !== 0 ||
    (effectiveUid !== undefined && stats.uid !== 0 && stats.uid !== effectiveUid)) {
    fail(`Observer ownership, type, or mode is unsafe: ${binaryPath}`);
  }

  const architectures = capture('xcrun', ['lipo', '-archs', binaryPath]);
  if (architectures !== target.lipoArch) {
    fail(`Observer architecture mismatch for ${target.directory}: ${architectures}`);
  }

  const dependencies = capture('xcrun', ['otool', '-L', binaryPath])
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
  if (dependencies.length === 0 || dependencies.some((dependency) =>
    !dependency.startsWith('/usr/lib/') && !dependency.startsWith('/System/Library/'))) {
    fail(`Observer has an unexpected dynamic dependency: ${dependencies.join(', ')}`);
  }

  const loadCommands = capture('xcrun', ['otool', '-l', binaryPath]);
  if (!/\bminos 11\.0(?:\.0)?\b/.test(loadCommands) && !/\bversion 11\.0(?:\.0)?\b/.test(loadCommands)) {
    fail(`Observer does not declare the required macOS 11.0 minimum: ${binaryPath}`);
  }

  return { architectures, binary: binaryPath, dependencies };
}

function main() {
  if (process.platform !== 'darwin') fail('The packaged macOS observer must be verified on macOS.');
  if (!appPath) fail('Usage: node scripts/verify-macos-core-observer.mjs <Qortium Home.app>');
  accessSync(appPath, constants.R_OK);
  const verified = targets.map(verifyBinary);

  const hostDirectory = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : null;
  if (!hostDirectory) fail(`Unsupported verification host architecture: ${process.arch}`);
  const hostBinary = verified.find((entry) => path.basename(path.dirname(entry.binary)) === hostDirectory)?.binary;
  if (!hostBinary) fail(`Packaged observer is missing the host architecture ${hostDirectory}.`);
  const selfTest = JSON.parse(capture(hostBinary, ['self-test']));
  if (selfTest?.schema !== 'qortium-core-observer' || selfTest?.schemaVersion !== 1 ||
    selfTest?.platform !== 'darwin' || selfTest?.arch !== hostDirectory ||
    selfTest?.mode !== 'self-test' || selfTest?.status !== 'ok') {
    fail('The packaged observer self-test returned an invalid envelope.');
  }

  console.log(JSON.stringify({ app: appPath, selfTest: 'passed', verified }));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
