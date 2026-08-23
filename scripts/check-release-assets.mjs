#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultRepository = 'QortiumDev/qortium-home';
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

function printHelp() {
  console.log(`Usage: node scripts/check-release-assets.mjs [options]

Checks local release artifacts, prints SHA-256 hashes, and verifies that the
matching GitHub release has the expected uploaded assets and digests.

Options:
  --tag <tag>         Release tag to check. Default: v${packageJson.version}
  --repo <owner/repo> GitHub repository. Default: ${defaultRepository}
  --allow-unsigned-android
                      Check locally built unsigned Android release artifacts.
                      Unsigned Android artifacts are never accepted for GitHub
                      release verification.
  --android-only      Only check Android release artifacts.
  --include-aab       Include the Android release AAB in the expected artifact set.
  --skip-github      Only check local artifacts and the platform matrix.
  --help             Show this help text.`);
}

function parseArgs(argv) {
  const options = {
    allowUnsignedAndroid: false,
    androidOnly: false,
    repository: defaultRepository,
    includeAab: false,
    skipGithub: false,
    tag: `v${packageJson.version}`,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    if (arg === '--skip-github') {
      options.skipGithub = true;
      continue;
    }

    if (arg === '--android-only') {
      options.androidOnly = true;
      continue;
    }

    if (arg === '--include-aab') {
      options.includeAab = true;
      continue;
    }

    if (arg === '--allow-unsigned-android') {
      options.allowUnsignedAndroid = true;
      continue;
    }

    if (arg === '--repo' || arg === '--tag') {
      const value = argv[index + 1];

      if (!value) {
        throw new Error(`${arg} requires a value.`);
      }

      if (arg === '--repo') {
        options.repository = value;
      } else {
        options.tag = value;
      }

      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function getExpectedArtifacts(version, options = {}) {
  const androidReleaseSuffix = options.allowUnsignedAndroid ? '-unsigned' : '';
  const artifacts = [
    {
      group: 'desktop',
      label: 'Linux x64 AppImage',
      matrixLabels: ['Linux x64'],
      name: `Qortium-Home-${version}-x86_64.AppImage`,
      path: path.join(repoRoot, 'dist-release', `Qortium-Home-${version}-x86_64.AppImage`),
      requiresExecutable: true,
    },
    {
      group: 'desktop',
      label: 'Linux arm64 AppImage',
      matrixLabels: ['Linux arm64'],
      name: `Qortium-Home-${version}-arm64.AppImage`,
      path: path.join(repoRoot, 'dist-release', `Qortium-Home-${version}-arm64.AppImage`),
      requiresExecutable: true,
    },
    {
      group: 'desktop',
      label: 'Windows x64 portable EXE',
      matrixLabels: ['Windows x64'],
      name: `Qortium-Home-${version}-x64.exe`,
      path: path.join(repoRoot, 'dist-release', `Qortium-Home-${version}-x64.exe`),
    },
    {
      group: 'desktop',
      label: 'macOS universal DMG',
      matrixLabels: ['macOS universal'],
      name: `Qortium-Home-${version}-universal.dmg`,
      path: path.join(repoRoot, 'dist-release', `Qortium-Home-${version}-universal.dmg`),
    },
    {
      group: 'desktop',
      label: 'macOS 11 legacy universal DMG',
      matrixLabels: ['macOS 11 legacy universal'],
      name: `Qortium-Home-${version}-macos11-universal.dmg`,
      path: path.join(repoRoot, 'dist-release', `Qortium-Home-${version}-macos11-universal.dmg`),
    },
    {
      group: 'desktop',
      label: 'macOS 10.15 legacy x64 DMG',
      matrixLabels: ['macOS 10.15 x64'],
      name: `Qortium-Home-${version}-macos1015-x64.dmg`,
      path: path.join(repoRoot, 'dist-release', `Qortium-Home-${version}-macos1015-x64.dmg`),
    },
    {
      group: 'android',
      label: `Android release APK${options.allowUnsignedAndroid ? ' (unsigned)' : ''}`,
      matrixLabels: ['Android APK'],
      name: `Qortium-Home-${version}-android-release${androidReleaseSuffix}.apk`,
      path: path.join(
        repoRoot,
        'dist-release',
        `Qortium-Home-${version}-android-release${androidReleaseSuffix}.apk`,
      ),
    },
  ];

  if (options.includeAab) {
    artifacts.push({
      group: 'android',
      label: `Android release AAB${options.allowUnsignedAndroid ? ' (unsigned)' : ''}`,
      matrixLabels: ['Android AAB'],
      name: `Qortium-Home-${version}-android-release${androidReleaseSuffix}.aab`,
      path: path.join(
        repoRoot,
        'dist-release',
        `Qortium-Home-${version}-android-release${androidReleaseSuffix}.aab`,
      ),
    });
  }

  return options.androidOnly ? artifacts.filter((artifact) => artifact.group === 'android') : artifacts;
}

function stripTagPrefix(tag) {
  return tag.replace(/^v/i, '');
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unitIndex]}`;
}

function digestFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function readLocalArtifacts(expectedArtifacts) {
  const results = new Map();

  for (const artifact of expectedArtifacts) {
    if (!existsSync(artifact.path)) {
      throw new Error(`Missing local artifact for ${artifact.label}: ${path.relative(repoRoot, artifact.path)}`);
    }

    const stat = statSync(artifact.path);

    if (artifact.requiresExecutable && (stat.mode & 0o100) === 0) {
      throw new Error(
        `Local artifact is not executable: ${path.relative(repoRoot, artifact.path)}. Run npm run chmod:linux:appimages or rebuild it with the Linux dist script.`,
      );
    }

    const sha256 = await digestFile(artifact.path);

    results.set(artifact.name, {
      ...artifact,
      sha256,
      size: stat.size,
    });
  }

  return results;
}

async function fetchGithubRelease(repository, tag) {
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'QortiumHomeReleaseCheck/1.0',
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `GitHub release lookup failed with HTTP ${response.status}.`);
  }

  return JSON.parse(text);
}

function readGithubAssets(release) {
  if (!Array.isArray(release.assets)) {
    throw new Error('GitHub release assets did not match the expected shape.');
  }

  return new Map(release.assets.map((asset) => [asset.name, asset]));
}

function verifyGithubAssets(localArtifacts, release) {
  const assetsByName = readGithubAssets(release);

  for (const artifact of localArtifacts.values()) {
    const asset = assetsByName.get(artifact.name);

    if (!asset) {
      throw new Error(`GitHub release is missing ${artifact.name}.`);
    }

    if (asset.state !== 'uploaded') {
      throw new Error(`GitHub asset ${artifact.name} is not uploaded. State: ${asset.state ?? 'unknown'}`);
    }

    if (asset.size !== artifact.size) {
      throw new Error(
        `GitHub asset ${artifact.name} size mismatch. Local ${artifact.size}, GitHub ${asset.size}.`,
      );
    }

    if (asset.digest !== `sha256:${artifact.sha256}`) {
      throw new Error(
        `GitHub asset ${artifact.name} digest mismatch. Local sha256:${artifact.sha256}, GitHub ${
          asset.digest ?? 'missing'
        }.`,
      );
    }
  }
}

function printLocalSummary(localArtifacts) {
  console.log('Local artifacts:');

  for (const artifact of localArtifacts.values()) {
    console.log(
      `  OK ${artifact.label}: ${artifact.name} (${formatBytes(artifact.size)}) sha256:${artifact.sha256}`,
    );
  }
}

function printPlatformMatrix(localArtifacts) {
  console.log('\nRelease platform matrix:');

  for (const artifact of localArtifacts.values()) {
    for (const label of artifact.matrixLabels) {
      console.log(`  OK ${label} -> ${artifact.name}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.allowUnsignedAndroid && !options.skipGithub) {
    throw new Error('--allow-unsigned-android can only be used with --skip-github.');
  }

  const version = stripTagPrefix(options.tag);
  const expectedArtifacts = getExpectedArtifacts(version, options);
  const localArtifacts = await readLocalArtifacts(expectedArtifacts);

  printLocalSummary(localArtifacts);
  printPlatformMatrix(localArtifacts);

  if (options.skipGithub) {
    console.log('\nGitHub release check skipped.');
    return;
  }

  const release = await fetchGithubRelease(options.repository, options.tag);

  verifyGithubAssets(localArtifacts, release);
  console.log(
    `\nGitHub release OK: ${options.repository} ${options.tag} (${release.prerelease ? 'prerelease' : 'stable'})`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
