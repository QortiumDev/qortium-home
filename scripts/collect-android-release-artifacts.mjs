#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const distReleasePath = path.join(repoRoot, 'dist-release');

function printHelp() {
  console.log(`Usage: node scripts/collect-android-release-artifacts.mjs [options]

Copies Android release APK/AAB outputs into dist-release with canonical names.
Unsigned outputs are kept separate with an -unsigned suffix so they cannot be
mistaken for installable public release artifacts.

Options:
  --apk   Collect the release APK only.
  --aab   Collect the release AAB only.
  --help  Show this help text.`);
}

function parseArgs(argv) {
  const options = {
    apk: false,
    aab: false,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    if (arg === '--apk') {
      options.apk = true;
      continue;
    }

    if (arg === '--aab') {
      options.aab = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.apk && !options.aab) {
    options.apk = true;
    options.aab = true;
  }

  return options;
}

function formatRelative(filePath) {
  return path.relative(repoRoot, filePath);
}

function listFiles(directory, extension) {
  if (!existsSync(directory)) {
    throw new Error(`Android release output directory was not found: ${formatRelative(directory)}`);
  }

  return readdirSync(directory)
    .filter((entry) => entry.toLowerCase().endsWith(extension))
    .map((entry) => path.join(directory, entry))
    .sort((first, second) => statSync(second).mtimeMs - statSync(first).mtimeMs);
}

function findNewestOutput(directory, extension, label) {
  const outputs = listFiles(directory, extension);

  if (!outputs[0]) {
    throw new Error(`No ${label} output was found in ${formatRelative(directory)}.`);
  }

  return outputs[0];
}

function getAndroidSdkRoot() {
  return (
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(os.homedir(), 'Android', 'Sdk')
  );
}

function findApkSigner() {
  const buildToolsPath = path.join(getAndroidSdkRoot(), 'build-tools');

  if (!existsSync(buildToolsPath)) {
    return null;
  }

  const binaryName = process.platform === 'win32' ? 'apksigner.bat' : 'apksigner';

  return readdirSync(buildToolsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((first, second) => second.localeCompare(first, undefined, { numeric: true }))
    .map((version) => path.join(buildToolsPath, version, binaryName))
    .find((candidate) => existsSync(candidate)) ?? null;
}

function isApkSigned(apkPath) {
  const apkSigner = findApkSigner();

  if (!apkSigner) {
    console.warn('Unable to find Android SDK apksigner; treating the release APK as unsigned.');
    return false;
  }

  const result = spawnSync(apkSigner, ['verify', '--verbose', apkPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return result.status === 0;
}

function isAabSigned(aabPath) {
  const result = spawnSync('jarsigner', ['-verify', aabPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    console.warn('Unable to run jarsigner; treating the release AAB as unsigned.');
    return false;
  }

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const unsignedPattern = /jar is unsigned|jar will be treated as unsigned|this jar contains unsigned entries|no manifest/i;

  return result.status === 0 && !unsignedPattern.test(output);
}

function removeCanonicalSiblings(extension) {
  for (const unsignedSuffix of ['', '-unsigned']) {
    rmSync(path.join(distReleasePath, `Qortium-Home-${packageJson.version}-android-release${unsignedSuffix}${extension}`), {
      force: true,
    });
  }
}

function collectArtifact({ extension, label, signed, sourcePath }) {
  mkdirSync(distReleasePath, { recursive: true });
  removeCanonicalSiblings(extension);

  const unsignedSuffix = signed ? '' : '-unsigned';
  const destinationPath = path.join(
    distReleasePath,
    `Qortium-Home-${packageJson.version}-android-release${unsignedSuffix}${extension}`,
  );

  copyFileSync(sourcePath, destinationPath);

  console.log(
    `Copied ${formatRelative(sourcePath)} -> ${formatRelative(destinationPath)} (${signed ? 'signed' : 'unsigned'} ${label}).`,
  );

  return { destinationPath, signed };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const collected = [];

  if (options.apk) {
    const sourcePath = findNewestOutput(
      path.join(repoRoot, 'android', 'app', 'build', 'outputs', 'apk', 'release'),
      '.apk',
      'release APK',
    );

    collected.push(collectArtifact({
      extension: '.apk',
      label: 'APK',
      signed: isApkSigned(sourcePath),
      sourcePath,
    }));
  }

  if (options.aab) {
    const sourcePath = findNewestOutput(
      path.join(repoRoot, 'android', 'app', 'build', 'outputs', 'bundle', 'release'),
      '.aab',
      'release AAB',
    );

    collected.push(collectArtifact({
      extension: '.aab',
      label: 'AAB',
      signed: isAabSigned(sourcePath),
      sourcePath,
    }));
  }

  if (collected.some((artifact) => !artifact.signed)) {
    console.warn(
      'Unsigned Android release artifacts are for local packaging checks only. Configure QORTIUM_HOME_ANDROID_* signing values before publishing Android release assets.',
    );
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
