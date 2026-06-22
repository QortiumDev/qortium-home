#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const macos11UniversalTarget = 'dist:mac:macos11:universal';
// Electron 36 (Chromium 136) is the last line that still targets macOS 11 (Big
// Sur); Electron 37+ (Chromium 138+) bumped the minimum to macOS 12, so their
// binaries' LC_BUILD_VERSION fails verify-macos-min-version against 11.0.0.
const macos11ElectronVersion = '36.9.5';
const allowedTargets = new Set(['dist:mac:x64', 'dist:mac:arm64', 'dist:mac:universal', macos11UniversalTarget]);
const defaultRemoteHost = 'qortium-macmini';
const defaultRemotePath = 'build/qortium-home';
const expectedHostFingerprint = 'SHA256:kviKojSotaQOxY94eVLQ8K+ootwbhH3cEu7C0ZaVPaY';
const remotePath = process.env.QORTIUM_MAC_REMOTE_PATH ?? defaultRemotePath;
const remoteHost = process.env.QORTIUM_MAC_HOST ?? defaultRemoteHost;
const remotePathEnv = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

function printHelp() {
  console.log(`Usage: node scripts/build-remote-mac.mjs <target>

Targets:
  dist:mac:x64
  dist:mac:arm64
  dist:mac:universal
  dist:mac:macos11:universal

Environment:
  QORTIUM_MAC_HOST         SSH host alias. Default: ${defaultRemoteHost}
  QORTIUM_MAC_REMOTE_PATH  Remote path under the Mac user's home directory. Default: ${defaultRemotePath}

The script builds the committed HEAD tree, not uncommitted local edits.`);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function run(command, args, options = {}) {
  const { label, ...spawnOptions } = options;

  console.log(label ?? `$ ${[command, ...args].map(shellQuote).join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    ...spawnOptions,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(stderr || `${command} exited with status ${result.status}`);
  }

  return result.stdout;
}

function requireCleanCommittedTree() {
  const status = capture('git', ['status', '--porcelain', '--untracked-files=no']).trim();

  if (status) {
    throw new Error(
      `Remote Mac builds package committed HEAD only. Commit or revert tracked local changes first:\n${status}`,
    );
  }
}

function validateRemotePath(value) {
  if (
    !value ||
    value.startsWith('/') ||
    value.startsWith('~') ||
    value.split('/').includes('..') ||
    !value.includes('qortium-home')
  ) {
    throw new Error(
      `Unsafe QORTIUM_MAC_REMOTE_PATH '${value}'. Use a relative path under the remote home directory that includes qortium-home.`,
    );
  }
}

function getSshHostname() {
  const sshConfig = capture('ssh', ['-G', remoteHost]);
  const hostLine = sshConfig
    .split('\n')
    .find((line) => line.toLowerCase().startsWith('hostname '));

  if (!hostLine) {
    throw new Error(`Unable to resolve HostName for ${remoteHost}.`);
  }

  return hostLine.split(/\s+/)[1];
}

function verifyMacHostFingerprint() {
  const hostname = getSshHostname();
  const keyscan = capture('ssh-keyscan', ['-T', '5', '-t', 'ed25519', hostname], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });

  if (!keyscan.trim()) {
    throw new Error(`Unable to read the ED25519 SSH host key from ${hostname}.`);
  }

  const fingerprint = capture('ssh-keygen', ['-lf', '-'], {
    input: keyscan,
  }).trim();

  console.log(fingerprint);

  if (!fingerprint.includes(expectedHostFingerprint)) {
    throw new Error(
      `Mac SSH host fingerprint mismatch. Expected ${expectedHostFingerprint}, got:\n${fingerprint}`,
    );
  }
}

function runRemote(script) {
  run('ssh', ['-o', 'BatchMode=yes', remoteHost, `/bin/bash -lc ${shellQuote(script)}`], {
    label: `$ ssh ${remoteHost} <remote script>`,
  });
}

function waitForProcess(process, name) {
  return new Promise((resolve, reject) => {
    process.on('error', reject);
    process.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${name} exited with status ${code}`));
    });
  });
}

async function syncCommittedTree() {
  const remoteScript = `
set -euo pipefail
export LANG=C
export LC_ALL=C
remote_dir="$HOME/${remotePath}"
rm -rf "$remote_dir"
mkdir -p "$remote_dir"
tar -xf - -C "$remote_dir"
`;

  console.log(`$ git archive --format=tar HEAD | ssh ${remoteHost} tar -xf -`);
  const gitArchive = spawn('git', ['archive', '--format=tar', 'HEAD'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const sshExtract = spawn(
    'ssh',
    ['-o', 'BatchMode=yes', remoteHost, `/bin/bash -lc ${shellQuote(remoteScript)}`],
    {
      cwd: repoRoot,
      stdio: ['pipe', 'inherit', 'inherit'],
    },
  );

  gitArchive.stdout.pipe(sshExtract.stdin);

  await Promise.all([
    waitForProcess(gitArchive, 'git archive'),
    waitForProcess(sshExtract, 'remote extract'),
  ]);
}

function getRemoteBuildScript(target) {
  if (target === macos11UniversalTarget) {
    return `
set -euo pipefail
version="$(node -p "require('./package.json').version")"
npm run build
./node_modules/.bin/electron-builder --mac dmg --universal --publish never -c.electronVersion=${macos11ElectronVersion} -c.mac.minimumSystemVersion=11.0.0
app_path="dist-release/mac-universal/Qortium Home.app"
if [ ! -d "$app_path" ]; then
  app_path="$(find dist-release -maxdepth 3 -type d -name 'Qortium Home.app' -print -quit)"
fi
if [ -z "$app_path" ] || [ ! -d "$app_path" ]; then
  echo "Expected macOS app bundle not found for legacy verification." >&2
  exit 1
fi
node scripts/verify-macos-min-version.mjs "$app_path" 11.0.0
normal_dmg="dist-release/Qortium-Home-$version-universal.dmg"
legacy_dmg="dist-release/Qortium-Home-$version-macos11-universal.dmg"
if [ ! -f "$normal_dmg" ]; then
  echo "Expected legacy macOS build output not found: $normal_dmg" >&2
  exit 1
fi
mv "$normal_dmg" "$legacy_dmg"
if [ -f "$normal_dmg.blockmap" ]; then
  mv "$normal_dmg.blockmap" "$legacy_dmg.blockmap"
fi
`;
  }

  return `npm run ${shellQuote(target)}`;
}

function buildRemote(target, commit) {
  const remoteScript = `
set -euo pipefail
export LANG=C
export LC_ALL=C
export PATH=${shellQuote(remotePathEnv)}
remote_dir="$HOME/${remotePath}"
target=${shellQuote(target)}
cd "$remote_dir"
printf 'Building Qortium Home commit ${commit} on %s\\n' "$(hostname)"
node --version
npm --version
npm ci
rm -rf dist-release
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -dimsu /bin/bash -lc ${shellQuote(getRemoteBuildScript(target))}
else
  /bin/bash -lc ${shellQuote(getRemoteBuildScript(target))}
fi
ls -lh dist-release/*.dmg
`;

  runRemote(remoteScript);
}

function copyArtifacts() {
  const localDistRelease = path.join(repoRoot, 'dist-release');

  mkdirSync(localDistRelease, { recursive: true });
  run('scp', ['-p', `${remoteHost}:${remotePath}/dist-release/*.dmg`, `${localDistRelease}/`]);
}

async function main() {
  const [target] = process.argv.slice(2);

  if (!target || target === '--help' || target === '-h') {
    printHelp();
    process.exit(target ? 0 : 1);
  }

  if (!allowedTargets.has(target)) {
    throw new Error(`Unsupported remote Mac build target '${target}'. Run with --help for valid targets.`);
  }

  validateRemotePath(remotePath);
  requireCleanCommittedTree();

  const commit = capture('git', ['rev-parse', '--short=12', 'HEAD']).trim();

  verifyMacHostFingerprint();
  runRemote('printf "remote ready: "; hostname');
  await syncCommittedTree();
  buildRemote(target, commit);
  copyArtifacts();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
