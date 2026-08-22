#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(repoRoot, 'native', 'macos', 'qortium-core-observer.c');
const buildRoot = path.join(repoRoot, '.native-build', 'macos');
const targets = [
  { directory: 'x64', clangArch: 'x86_64' },
  { directory: 'arm64', clangArch: 'arm64' },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${command} exited with status ${result.status}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean).join('\n'));
  }
  return result.stdout.trim();
}

function sha256(targetPath) {
  return createHash('sha256').update(readFileSync(targetPath)).digest('hex');
}

function compileTarget(target) {
  const outputDirectory = path.join(buildRoot, target.directory);
  const outputPath = path.join(outputDirectory, 'qortium-core-observer');
  mkdirSync(outputDirectory, { recursive: true });
  run('xcrun', [
    '--sdk',
    'macosx',
    'clang',
    '-arch',
    target.clangArch,
    '-mmacosx-version-min=11.0',
    '-std=c11',
    '-O2',
    '-Wall',
    '-Wextra',
    '-Wpedantic',
    '-Werror',
    sourcePath,
    '-o',
    outputPath,
  ]);
  chmodSync(outputPath, 0o755);
  const architectures = run('xcrun', ['lipo', '-archs', outputPath]);
  if (architectures !== target.clangArch) {
    throw new Error(`Unexpected architecture for ${outputPath}: ${architectures}`);
  }
  return { architectures, outputPath, sha256: sha256(outputPath) };
}

function runNativeSelfTest(results) {
  const hostDirectory = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
  if (!hostDirectory) {
    return { status: 'skipped', reason: `unsupported build-host architecture ${process.arch}` };
  }
  const binary = results.find((result) => path.basename(path.dirname(result.outputPath)) === hostDirectory);
  if (!binary) throw new Error(`No observer binary was built for host architecture ${process.arch}.`);
  const output = run(binary.outputPath, ['self-test']);
  const parsed = JSON.parse(output);
  if (
    parsed?.schema !== 'qortium-core-observer' ||
    parsed?.schemaVersion !== 1 ||
    parsed?.platform !== 'darwin' ||
    parsed?.arch !== hostDirectory ||
    parsed?.mode !== 'self-test' ||
    parsed?.status !== 'ok'
  ) {
    throw new Error(`Native observer self-test returned an invalid result: ${output}`);
  }
  return { status: 'passed', binary: binary.outputPath };
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('The macOS Core observer must be built on macOS with xcrun and the macOS SDK.');
  }
  run('xcrun', ['--find', 'clang']);
  const results = targets.map(compileTarget);
  const selfTest = runNativeSelfTest(results);
  for (const result of results) {
    console.log(JSON.stringify({
      architecture: result.architectures,
      output: path.relative(repoRoot, result.outputPath),
      sha256: result.sha256,
    }));
  }
  console.log(JSON.stringify({ selfTest }));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
