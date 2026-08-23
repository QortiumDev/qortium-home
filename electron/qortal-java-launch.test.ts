import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import {
  isSupportedOpenJdkVersionOutput,
  resolveExecutableOnPath,
  resolveVerifiedOpenJdkJava,
  type JavaExecutableFileOperations,
} from './qortal-java-launch.js';

type FakeKind = 'file' | 'directory' | 'symlink';

function windowsFileOperations(entries: Record<string, FakeKind>) {
  const normalized = new Map(
    Object.entries(entries).map(([candidate, kind]) => [candidate.toLowerCase(), { candidate, kind }]),
  );
  const lookup = (candidate: string) => {
    const entry = normalized.get(candidate.toLowerCase());
    if (!entry) throw new Error('ENOENT');
    return entry;
  };
  const operations: JavaExecutableFileOperations = {
    async access(candidate) {
      lookup(candidate);
    },
    async lstat(candidate) {
      const { kind } = lookup(candidate);
      return {
        isFile: () => kind === 'file',
        isSymbolicLink: () => kind === 'symlink',
      };
    },
    async realpath(candidate) {
      return lookup(candidate).candidate;
    },
  };
  return operations;
}

const spacedJava = 'C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\java.exe';
const spacedOperations = windowsFileOperations({ [spacedJava]: 'file' });

assert.equal(
  await resolveExecutableOnPath(spacedJava, {}, 'win32', spacedOperations),
  spacedJava,
  'an explicit absolute java.exe path with spaces is accepted',
);
assert.equal(
  await resolveExecutableOnPath(
    'JAVA.EXE',
    { Path: `C:\\missing;C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin` },
    'win32',
    spacedOperations,
  ),
  spacedJava,
  'Windows PATH lookup is case-insensitive for both the environment key and executable name',
);
assert.equal(
  await resolveExecutableOnPath(
    'java',
    { PATH: `;C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin;;`, PATHEXT: '.CMD;.BAT' },
    'win32',
    spacedOperations,
  ),
  spacedJava,
  'empty PATH entries are ignored and PATHEXT cannot redirect the fixed .exe lookup',
);
assert.equal(
  await resolveExecutableOnPath(
    'java',
    { PATH: 'relative\\bin;C:\\unsafe\0bin' },
    'win32',
    spacedOperations,
  ),
  null,
  'relative and NUL-containing Windows PATH entries are never resolved against the app cwd',
);
assert.equal(
  await resolveExecutableOnPath(
    'java',
    { PATH: 'C:\\Program Files\\Eclipse Adoptium\\jdk-21\\other\\..\\bin' },
    'win32',
    spacedOperations,
  ),
  null,
  'non-canonical absolute PATH entries are rejected instead of silently normalized',
);

for (const command of [
  '',
  '   ',
  'java\0.exe',
  'java.cmd',
  'not-java.exe',
  '.\\java.exe',
  'bin\\java.exe',
  'C:\\Java\\bin\\java',
  'C:\\Java\\bin\\not-java.exe',
]) {
  assert.equal(
    await resolveExecutableOnPath(command, { PATH: 'C:\\Java\\bin' }, 'win32', spacedOperations),
    null,
    `unsafe Windows command is rejected: ${JSON.stringify(command)}`,
  );
}

const symlinkJava = 'C:\\Java\\bin\\java.exe';
assert.equal(
  await resolveExecutableOnPath(
    'java',
    { PATH: 'C:\\Java\\bin' },
    'win32',
    windowsFileOperations({ [symlinkJava]: 'symlink' }),
  ),
  null,
  'a Windows symlink/reparse-like executable is rejected before launch',
);
assert.equal(
  await resolveExecutableOnPath(
    'java',
    { PATH: 'C:\\Java\\bin' },
    'win32',
    windowsFileOperations({ [symlinkJava]: 'directory' }),
  ),
  null,
  'a non-regular Windows path is rejected',
);

const nonCanonicalRealpathOperations: JavaExecutableFileOperations = {
  async access() {},
  async lstat() {
    return { isFile: () => true, isSymbolicLink: () => false };
  },
  async realpath() {
    return 'C:\\Java\\jdk-21\\bin\\..\\bin\\java.exe';
  },
};
assert.equal(
  await resolveExecutableOnPath(
    'C:\\Java\\jdk-21\\bin\\java.exe',
    {},
    'win32',
    nonCanonicalRealpathOperations,
  ),
  null,
  'a non-canonical realpath result is rejected',
);

const renamedRealpathOperations: JavaExecutableFileOperations = {
  ...nonCanonicalRealpathOperations,
  async realpath() {
    return 'C:\\Java\\jdk-21\\bin\\java-launcher.exe';
  },
};
assert.equal(
  await resolveExecutableOnPath(
    'C:\\Java\\jdk-21\\bin\\java.exe',
    {},
    'win32',
    renamedRealpathOperations,
  ),
  null,
  'the canonical executable must still be named java.exe',
);

const observedSpawns: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];
const fakeSpawn = ((command: string, args: readonly string[], options: SpawnOptions) => {
  observedSpawns.push({ command, args, options });
  const child = new EventEmitter() as ChildProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = () => true;
  queueMicrotask(() => {
    stderr.write('openjdk version "21.0.7" 2025-04-15\n');
    child.emit('close', 0, null);
  });
  return child;
}) as typeof import('node:child_process').spawn;

assert.equal(
  await resolveVerifiedOpenJdkJava('java', { PATH: 'C:\\Java\\bin' }, {
    platform: 'win32',
    fileOperations: windowsFileOperations({ [symlinkJava]: 'file' }),
    spawnProcess: fakeSpawn,
  }),
  symlinkJava,
  'the canonical Windows executable passes the bounded OpenJDK 17+ proof',
);
assert.equal(observedSpawns[0]?.command, symlinkJava);
assert.deepEqual(observedSpawns[0]?.args, ['-version']);
assert.equal(observedSpawns[0]?.options.shell, false, 'the Java version probe never invokes a shell');
assert.equal(observedSpawns[0]?.options.windowsHide, true);

assert.equal(isSupportedOpenJdkVersionOutput('openjdk version "17.0.15"'), true);
assert.equal(isSupportedOpenJdkVersionOutput('openjdk version "16.0.2"'), false);
assert.equal(isSupportedOpenJdkVersionOutput('java version "21.0.1"'), false);

console.log('Qortal Java launch tests passed.');
