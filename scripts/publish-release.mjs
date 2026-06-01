#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultRepository = 'QortiumDev/qortium-home';
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

function printHelp() {
  console.log(`Usage: node scripts/publish-release.mjs [options]

Publishes the current Qortium Home version as a GitHub prerelease.

The script verifies local artifacts, ensures the git tag exists on origin,
creates the release, uploads each asset one at a time, then verifies GitHub
asset sizes and SHA-256 digests.

Options:
  --tag <tag>          Release tag. Default: v${packageJson.version}
  --repo <owner/repo>  GitHub repository. Default: ${defaultRepository}
  --title <title>      Release title. Default: Qortium Home v${packageJson.version}
  --notes <text>       Release notes text.
  --notes-file <path>  Read release notes from a UTF-8 file.
  --reuse-release      Upload into an existing release instead of creating one.
  --clobber            Re-upload existing assets with the same name.
  --dry-run            Print the publish actions without changing GitHub.
  --help              Show this help text.

This command pushes the tag when it is missing on origin.`);
}

function parseArgs(argv) {
  const options = {
    clobber: false,
    dryRun: false,
    notes: '',
    repository: defaultRepository,
    reuseRelease: false,
    tag: `v${packageJson.version}`,
    title: `Qortium Home v${packageJson.version}`,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    if (arg === '--clobber') {
      options.clobber = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--reuse-release') {
      options.reuseRelease = true;
      continue;
    }

    if (['--notes', '--notes-file', '--repo', '--tag', '--title'].includes(arg)) {
      const value = argv[index + 1];

      if (!value) {
        throw new Error(`${arg} requires a value.`);
      }

      if (arg === '--notes') {
        options.notes = value;
      } else if (arg === '--notes-file') {
        options.notes = readFileSync(path.resolve(repoRoot, value), 'utf8').trim();
      } else if (arg === '--repo') {
        options.repository = value;
      } else if (arg === '--tag') {
        options.tag = value;
        options.title = `Qortium Home ${value}`;
      } else {
        options.title = value;
      }

      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.notes) {
    options.notes = `${options.title} prerelease.`;
  }

  return options;
}

function stripTagPrefix(tag) {
  return tag.replace(/^v/i, '');
}

function getExpectedArtifacts(version) {
  return [
    path.join(repoRoot, 'dist-release', `Qortium-Home-${version}-x86_64.AppImage`),
    path.join(repoRoot, 'dist-release', `Qortium-Home-${version}-arm64.AppImage`),
    path.join(repoRoot, 'dist-release', `Qortium-Home-${version}-x64.exe`),
    path.join(repoRoot, 'dist-release', `Qortium-Home-${version}-universal.dmg`),
    path.join(repoRoot, 'dist-release', `Qortium-Home-${version}-android-release.apk`),
    path.join(repoRoot, 'dist-release', `Qortium-Home-${version}-android-release.aab`),
  ];
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function formatCommand(command, args) {
  return [command, ...args].map(shellQuote).join(' ');
}

function run(command, args, options = {}) {
  const { dryRun = false, input, label, quiet = false } = options;

  if (!quiet || dryRun) {
    console.log(label ?? `$ ${formatCommand(command, args)}`);
  }

  if (dryRun) {
    return { status: 0, stdout: '', stderr: '' };
  }

  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    stdio: quiet ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'],
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr || `${command} exited with status ${result.status}`);
  }

  return result;
}

function capture(command, args, options = {}) {
  return run(command, args, { ...options, quiet: true }).stdout;
}

function exists(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return result.status === 0;
}

function requireCleanCommittedTree(options) {
  const status = capture('git', ['status', '--porcelain', '--untracked-files=no']).trim();

  if (status) {
    if (options.dryRun) {
      console.log(`Dry run with tracked changes present:\n${status}`);
      return;
    }

    throw new Error(`Release publishing requires a clean tracked tree:\n${status}`);
  }
}

function verifyLocalArtifacts(options) {
  const version = stripTagPrefix(options.tag);
  const artifacts = getExpectedArtifacts(version);

  for (const artifact of artifacts) {
    if (!existsSync(artifact)) {
      throw new Error(`Missing local release artifact: ${path.relative(repoRoot, artifact)}`);
    }
  }

  run('node', ['scripts/check-release-assets.mjs', '--tag', options.tag, '--repo', options.repository, '--skip-github'], {
    dryRun: options.dryRun,
  });

  return artifacts;
}

function ensureTag(options) {
  const head = capture('git', ['rev-parse', 'HEAD']).trim();
  const localTagExists = exists('git', ['rev-parse', '--verify', `refs/tags/${options.tag}`]);

  if (localTagExists) {
    const tagCommit = capture('git', ['rev-list', '-n', '1', options.tag]).trim();

    if (tagCommit !== head) {
      throw new Error(`Local tag ${options.tag} points at ${tagCommit}, not HEAD ${head}.`);
    }
  } else {
    run('git', ['tag', options.tag, 'HEAD'], { dryRun: options.dryRun });
  }

  const remoteTag = capture('git', ['ls-remote', '--tags', 'origin', options.tag]).trim();

  if (!remoteTag) {
    run('git', ['push', 'origin', options.tag], { dryRun: options.dryRun });
    return;
  }

  const [remoteCommit] = remoteTag.split(/\s+/);

  if (remoteCommit !== head) {
    throw new Error(`Remote tag ${options.tag} points at ${remoteCommit}, not HEAD ${head}.`);
  }
}

function releaseExists(options) {
  return exists('gh', ['release', 'view', options.tag, '--repo', options.repository]);
}

function createRelease(options) {
  const foundRelease = releaseExists(options);

  if (foundRelease && !options.reuseRelease) {
    throw new Error(`Release ${options.tag} already exists. Use --reuse-release to upload assets into it.`);
  }

  if (foundRelease) {
    console.log(`Using existing release ${options.tag}.`);
    return;
  }

  run(
    'gh',
    [
      'release',
      'create',
      options.tag,
      '--repo',
      options.repository,
      '--verify-tag',
      '--prerelease',
      '--title',
      options.title,
      '--notes',
      options.notes,
    ],
    { dryRun: options.dryRun },
  );
}

function uploadArtifacts(options, artifacts) {
  for (const artifact of artifacts) {
    const args = ['release', 'upload', options.tag, artifact, '--repo', options.repository];

    if (options.clobber) {
      args.push('--clobber');
    }

    run('gh', args, {
      dryRun: options.dryRun,
      label: `$ gh release upload ${shellQuote(options.tag)} ${shellQuote(path.relative(repoRoot, artifact))}`,
    });
  }
}

function verifyGithubRelease(options) {
  run('node', ['scripts/check-release-assets.mjs', '--tag', options.tag, '--repo', options.repository], {
    dryRun: options.dryRun,
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  requireCleanCommittedTree(options);
  run('gh', ['auth', 'status'], { dryRun: options.dryRun });

  const artifacts = verifyLocalArtifacts(options);

  ensureTag(options);
  createRelease(options);
  uploadArtifacts(options, artifacts);
  verifyGithubRelease(options);

  console.log(`Release publish complete: ${options.repository} ${options.tag}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
