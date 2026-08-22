#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(repoRoot, 'native', 'windows', 'qortium-core-observer.cpp');
const outputDirectory = path.join(repoRoot, '.native-build', 'windows', 'x64');
const outputPath = path.join(outputDirectory, 'qortium-core-observer.exe');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
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
  if (result.stderr.length !== 0) {
    throw new Error(`${command} produced unexpected diagnostic output.`);
  }
  return result.stdout.trim();
}

function findVsDevCmd() {
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  if (!programFilesX86) return null;
  const vswhere = path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const result = spawnSync(vswhere, [
    '-latest',
    '-products', '*',
    '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property', 'installationPath',
  ], { encoding: 'utf8', shell: false, windowsHide: true });
  if (result.error || result.status !== 0 || !result.stdout.trim()) return null;
  return path.join(result.stdout.trim(), 'Common7', 'Tools', 'VsDevCmd.bat');
}

function compileWithConfiguredCl(environment = process.env) {
  return spawnSync('cl.exe', [
    '/nologo', '/std:c++17', '/O2', '/W4', '/WX', '/EHsc', '/utf-8', '/permissive-', '/guard:cf', '/MT',
    '/DUNICODE', '/D_UNICODE', '/DWIN32_LEAN_AND_MEAN', '/DNOMINMAX',
    sourcePath,
    `/Fe:${outputPath}`,
    `/Fo:${path.join(outputDirectory, 'qortium-core-observer.obj')}`,
    '/link', '/INCREMENTAL:NO', '/DYNAMICBASE', '/NXCOMPAT', '/HIGHENTROPYVA', '/CETCOMPAT',
    'advapi32.lib', 'iphlpapi.lib', 'shell32.lib', 'ws2_32.lib',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: environment,
  });
}

function visualStudioEnvironment(vsDevCmd) {
  if (/[&|<>%^!"\r\n]/u.test(vsDevCmd)) {
    throw new Error('Visual Studio reported an unsafe developer-command path.');
  }
  const command = `call "${vsDevCmd}" -no_logo -arch=x64 -host_arch=x64 >nul && set`;
  const result = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`VsDevCmd.bat exited with status ${result.status}.`);
  }
  const environment = { ...process.env };
  for (const line of result.stdout.split(/\r?\n/u)) {
    const separator = line.indexOf('=');
    if (separator > 0) environment[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return environment;
}

function compile() {
  mkdirSync(outputDirectory, { recursive: true });
  let result = compileWithConfiguredCl();
  if (!result.error && result.status === 0) return;

  const vsDevCmd = findVsDevCmd();
  if (!vsDevCmd) {
    throw new Error([
      'MSVC cl.exe is not configured and Visual Studio Build Tools with the x64 C++ workload was not found.',
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean).join('\n'));
  }

  // cmd.exe is used only to materialize VsDevCmd's environment. Compilation
  // remains a shell:false argv invocation, so repository paths are never code.
  result = compileWithConfiguredCl(visualStudioEnvironment(vsDevCmd));
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([`MSVC exited with status ${result.status}`, result.stdout?.trim(), result.stderr?.trim()]
      .filter(Boolean).join('\n'));
  }
}

function sha256(targetPath) {
  return createHash('sha256').update(readFileSync(targetPath)).digest('hex');
}

function verifyPeX64() {
  const bytes = readFileSync(outputPath);
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error('The native observer output is not a PE executable.');
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset > bytes.length - 6 || bytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0' ||
      bytes.readUInt16LE(peOffset + 4) !== 0x8664) {
    throw new Error('The native observer output is not a Windows x64 PE executable.');
  }
}

function selfTest() {
  const output = run(outputPath, ['self-test']);
  const parsed = JSON.parse(output);
  const expectedKeys = ['arch', 'mode', 'platform', 'schema', 'schemaVersion', 'status'];
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' ||
      JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(expectedKeys) ||
      parsed.schema !== 'qortium-core-observer' || parsed.schemaVersion !== 1 ||
      parsed?.platform !== 'win32' || parsed?.arch !== 'x64' || parsed?.mode !== 'self-test' ||
      parsed?.status !== 'ok') {
    throw new Error(`Native observer self-test returned an invalid result: ${output}`);
  }
}

function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('The Windows Core observer must be built on Windows x64 with MSVC Build Tools.');
  }
  compile();
  verifyPeX64();
  selfTest();
  console.log(JSON.stringify({
    architecture: 'x64',
    output: path.relative(repoRoot, outputPath),
    sha256: sha256(outputPath),
    selfTest: 'passed',
  }));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
