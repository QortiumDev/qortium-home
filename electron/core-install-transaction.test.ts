import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCoreInstallTransaction } from './core-install-transaction.js';
import { movePath } from './filesystem-move.js';

function createTransactionPaths(label: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), `qortium-home-${label}-`));

  return {
    backup: path.join(root, '_install-backup'),
    candidate: path.join(root, '_install-staging', 'install'),
    install: path.join(root, 'install'),
    root,
  };
}

function writeMarker(directory: string, marker: string) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'marker.txt'), marker, 'utf8');
}

function readMarker(directory: string) {
  return readFileSync(path.join(directory, 'marker.txt'), 'utf8');
}

async function withTransactionPaths(
  label: string,
  callback: (paths: ReturnType<typeof createTransactionPaths>) => Promise<void>,
) {
  const paths = createTransactionPaths(label);

  try {
    await callback(paths);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
}

await withTransactionPaths('core-install-success', async (paths) => {
  writeMarker(paths.install, 'previous');
  writeMarker(paths.candidate, 'candidate');
  let activated = false;

  await runCoreInstallTransaction({
    activateCandidate: async () => {
      activated = true;
    },
    backupPath: paths.backup,
    candidatePath: paths.candidate,
    installPath: paths.install,
    restorePrevious: async () => {
      assert.fail('Successful install unexpectedly ran the restore callback.');
    },
  });

  assert.equal(activated, true);
  assert.equal(readMarker(paths.install), 'candidate');
  assert.equal(existsSync(paths.backup), false);
});

await withTransactionPaths('core-install-activation-failure', async (paths) => {
  writeMarker(paths.install, 'previous');
  writeMarker(paths.candidate, 'candidate');
  const metadataPath = path.join(paths.root, 'current.json');
  const activationError = new Error('candidate failed to start');
  writeFileSync(metadataPath, 'previous metadata', 'utf8');

  await assert.rejects(
    runCoreInstallTransaction({
      activateCandidate: async () => {
        writeFileSync(metadataPath, 'candidate metadata', 'utf8');
        throw activationError;
      },
      backupPath: paths.backup,
      candidatePath: paths.candidate,
      installPath: paths.install,
      restorePrevious: async () => {
        writeFileSync(metadataPath, 'previous metadata', 'utf8');
      },
    }),
    (error) => error === activationError,
  );

  assert.equal(readMarker(paths.install), 'previous');
  assert.equal(readFileSync(metadataPath, 'utf8'), 'previous metadata');
  assert.equal(existsSync(paths.backup), false);
});

await withTransactionPaths('core-install-restore-failure', async (paths) => {
  writeMarker(paths.install, 'previous');
  writeMarker(paths.candidate, 'candidate');
  const activationError = new Error('candidate failed to start');
  const restoreError = Object.assign(new Error('restore remained locked'), { code: 'EPERM' });

  await assert.rejects(
    runCoreInstallTransaction({
      activateCandidate: async () => {
        throw activationError;
      },
      backupPath: paths.backup,
      candidatePath: paths.candidate,
      installPath: paths.install,
      operations: {
        move: async (sourcePath, destinationPath, options) => {
          if (sourcePath === paths.backup) {
            throw restoreError;
          }

          await movePath(sourcePath, destinationPath, options);
        },
      },
      restorePrevious: async () => {
        assert.fail('Failed restore unexpectedly ran the restored-state callback.');
      },
    }),
    (error) => error === activationError,
  );

  assert.equal(existsSync(paths.install), false);
  assert.equal(readMarker(paths.backup), 'previous');
});

type WindowsLock = {
  child: ChildProcess;
  exited: Promise<void>;
};

async function acquireWindowsExclusiveLock(filePath: string, holdMs: number): Promise<WindowsLock> {
  const script = [
    '$stream = [System.IO.File]::Open(',
    '  $env:QORTIUM_LOCK_PATH,',
    '  [System.IO.FileMode]::Open,',
    '  [System.IO.FileAccess]::Read,',
    '  [System.IO.FileShare]::None',
    ')',
    '[Console]::Out.WriteLine("LOCK_READY")',
    '[Console]::Out.Flush()',
    'Start-Sleep -Milliseconds ([int]$env:QORTIUM_LOCK_HOLD_MS)',
    '$stream.Dispose()',
  ].join('\n');
  const child = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      env: {
        ...process.env,
        QORTIUM_LOCK_HOLD_MS: String(holdMs),
        QORTIUM_LOCK_PATH: filePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });

  child.stdout?.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const startedAt = Date.now();

  while (!stdout.includes('LOCK_READY')) {
    assert(Date.now() - startedAt < 10_000, `Timed out acquiring Windows lock: ${stderr || stdout}`);
    assert(child.exitCode === null, `Windows lock process exited early: ${stderr || stdout}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return { child, exited };
}

if (process.platform === 'win32') {
  await withTransactionPaths('core-install-real-temporary-lock', async (paths) => {
    writeMarker(paths.install, 'previous');
    writeMarker(paths.candidate, 'candidate');
    const lock = await acquireWindowsExclusiveLock(path.join(paths.install, 'marker.txt'), 2_500);
    const startedAt = Date.now();

    await runCoreInstallTransaction({
      activateCandidate: async () => {},
      backupPath: paths.backup,
      candidatePath: paths.candidate,
      installPath: paths.install,
      restorePrevious: async () => {
        assert.fail('Temporary-lock success unexpectedly restored the previous install.');
      },
    });

    const elapsedMs = Date.now() - startedAt;
    await lock.exited;
    assert(elapsedMs >= 3_000 && elapsedMs < 7_000, `Temporary lock recovered after ${elapsedMs} ms.`);
    assert.equal(readMarker(paths.install), 'candidate');
    assert.equal(existsSync(paths.backup), false);
  });

  await withTransactionPaths('core-install-real-persistent-lock', async (paths) => {
    writeMarker(paths.install, 'previous');
    writeMarker(paths.candidate, 'candidate');
    const lock = await acquireWindowsExclusiveLock(path.join(paths.install, 'marker.txt'), 20_000);
    const startedAt = Date.now();

    try {
      await assert.rejects(
        runCoreInstallTransaction({
          activateCandidate: async () => {
            assert.fail('Persistent lock unexpectedly activated the candidate.');
          },
          backupPath: paths.backup,
          candidatePath: paths.candidate,
          installPath: paths.install,
          restorePrevious: async () => {
            assert.fail('Persistent initial move failure unexpectedly ran restore.');
          },
        }),
        (error) => {
          const code = error instanceof Error && 'code' in error
            ? (error as NodeJS.ErrnoException).code
            : undefined;

          return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
        },
      );
    } finally {
      lock.child.kill();
      await lock.exited;
    }

    const elapsedMs = Date.now() - startedAt;
    assert(elapsedMs >= 7_000 && elapsedMs < 12_000, `Persistent lock failed after ${elapsedMs} ms.`);
    assert.equal(readMarker(paths.install), 'previous');
    assert.equal(readMarker(paths.candidate), 'candidate');
    assert.equal(existsSync(paths.backup), false);
  });
}

console.log(
  process.platform === 'win32'
    ? 'core install transaction and real Windows lock tests passed'
    : 'core install transaction tests passed (real lock scenarios require Windows)',
);
