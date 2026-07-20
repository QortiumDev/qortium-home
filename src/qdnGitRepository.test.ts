import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  QdnGitRepositoryReader,
  detectGitRepositoryLayout,
  type QdnGitFileFetcher,
} from './qdnGitRepository';

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

async function listFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await listFiles(root, fullPath)));
    } else if (entry.isFile()) {
      paths.push(relative(root, fullPath).replaceAll('\\', '/'));
    }
  }
  return paths.sort();
}

function localFetcher(root: string, requests: Map<string, number>): QdnGitFileFetcher {
  return async (path, maxBytes) => {
    requests.set(path, (requests.get(path) ?? 0) + 1);
    const bytes = await readFile(join(root, path));
    return {
      contentLength: bytes.length,
      data: bytes.length > maxBytes ? '' : bytes.toString('base64'),
      tooLarge: bytes.length > maxBytes,
    };
  };
}

async function run() {
  assert.equal(detectGitRepositoryLayout(['README.md']), null);
  assert.deepEqual(detectGitRepositoryLayout(['HEAD', 'objects/info/packs']), {
    gitdir: '/repo',
    kind: 'bare',
  });
  assert.deepEqual(detectGitRepositoryLayout(['.git/HEAD', '.git/objects/info/packs']), {
    gitdir: '/repo/.git',
    kind: 'worktree',
  });
  assert.throws(
    () => new QdnGitRepositoryReader(['.git/HEAD', '.git/objects/info/packs', '../escape'], async () => ({ data: '' })),
    /Unsafe Git repository path/,
  );
  assert.throws(
    () =>
      new QdnGitRepositoryReader(
        ['.git/HEAD', '.git/HEAD', '.git/objects/info/packs'],
        async () => ({ data: '' }),
      ),
    /duplicate paths/,
  );

  const oversized = new QdnGitRepositoryReader(
    ['HEAD', 'objects/info/packs'],
    async () => ({ data: '', tooLarge: true }),
  );
  await assert.rejects(oversized.fs.promises.readFile('/repo/HEAD'), /exceeds/);
  await assert.rejects(oversized.fs.promises.readFile('/repo/missing'), /not found/);

  const root = await mkdtemp(join(tmpdir(), 'qortium-home-git-test-'));
  const bareParent = await mkdtemp(join(tmpdir(), 'qortium-home-bare-git-test-'));
  try {
    git(root, 'init', '-b', 'main');
    git(root, 'config', 'user.name', 'Qortium Test Fixture');
    git(root, 'config', 'user.email', 'fixture@qortium.invalid');

    await writeFile(join(root, 'README.md'), '# Qortium fixture\n\nInitial version.\n');
    git(root, 'add', 'README.md');
    git(root, 'commit', '-m', 'Initial fixture');

    git(root, 'switch', '-c', 'feature/greeting');
    await writeFile(join(root, 'greeting.txt'), 'Hello from the feature branch.\n');
    git(root, 'add', 'greeting.txt');
    git(root, 'commit', '-m', 'Add branch greeting');

    git(root, 'switch', 'main');
    await writeFile(join(root, 'README.md'), '# Qortium fixture\n\nMain branch update.\n');
    await writeFile(join(root, 'CHANGELOG.md'), 'Second main commit.\n');
    git(root, 'add', 'README.md', 'CHANGELOG.md');
    git(root, 'commit', '-m', 'Update main fixture');
    git(root, 'gc', '--prune=now');

    const paths = await listFiles(root);
    const requests = new Map<string, number>();
    const reader = new QdnGitRepositoryReader(paths, localFetcher(root, requests));
    const overview = await reader.getOverview();

    assert.equal(overview.currentBranch, 'main');
    assert.deepEqual(overview.branches, ['feature/greeting', 'main']);

    const mainHistory = await reader.getHistory('main');
    assert.deepEqual(
      mainHistory.map((commit) => commit.summary),
      ['Update main fixture', 'Initial fixture'],
    );
    const featureHistory = await reader.getHistory('feature/greeting');
    assert.deepEqual(
      featureHistory.map((commit) => commit.summary),
      ['Add branch greeting', 'Initial fixture'],
    );

    const mainFiles = await reader.listFiles(mainHistory[0].oid);
    assert.deepEqual(mainFiles, ['CHANGELOG.md', 'README.md']);
    assert.equal(
      new TextDecoder().decode(await reader.readBlob(mainHistory[0].oid, 'README.md')),
      '# Qortium fixture\n\nMain branch update.\n',
    );
    const featureFiles = await reader.listFiles(featureHistory[0].oid);
    assert.deepEqual(featureFiles, ['README.md', 'greeting.txt']);
    assert.equal(
      new TextDecoder().decode(await reader.readBlob(featureHistory[0].oid, 'greeting.txt')),
      'Hello from the feature branch.\n',
    );

    await reader.getOverview();
    assert.equal(requests.get('.git/HEAD'), 1, 'Git file reads should be cached');

    const bareRoot = join(bareParent, 'fixture.git');
    git(root, 'clone', '--bare', root, bareRoot);
    git(bareRoot, 'gc', '--prune=now');
    const barePaths = await listFiles(bareRoot);
    const bareReader = new QdnGitRepositoryReader(barePaths, localFetcher(bareRoot, new Map()));
    assert.equal(bareReader.layout.kind, 'bare');
    const bareOverview = await bareReader.getOverview();
    assert.equal(bareOverview.currentBranch, 'main');
    const bareHistory = await bareReader.getHistory('feature/greeting');
    assert.equal(bareHistory[0].summary, 'Add branch greeting');
    assert.equal(
      new TextDecoder().decode(await bareReader.readBlob(bareHistory[0].oid, 'greeting.txt')),
      'Hello from the feature branch.\n',
    );

    // A tiny compressed object must not be allowed to expand without a bound.
    // This exercises the install-time isomorphic-git hardening through the real
    // packed-object read path, not merely the post-inflate blob-size check.
    await writeFile(join(root, 'inflation-bomb.bin'), new Uint8Array(17 * 1024 * 1024));
    git(root, 'add', 'inflation-bomb.bin');
    git(root, 'commit', '-m', 'Add oversized compressed fixture');
    git(root, 'gc', '--prune=now');
    const bombReader = new QdnGitRepositoryReader(
      await listFiles(root),
      localFetcher(root, new Map()),
    );
    const bombHistory = await bombReader.getHistory('main');
    await assert.rejects(
      bombReader.readBlob(bombHistory[0].oid, 'inflation-bomb.bin'),
      /inflation limit/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
    await rm(bareParent, { force: true, recursive: true });
  }
}

await run();
console.log('QDN Git repository tests passed.');
