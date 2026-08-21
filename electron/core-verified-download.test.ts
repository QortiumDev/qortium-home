import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import {
  downloadVerifiedCoreAsset,
  type VerifiedCoreDownloadAsset,
  type VerifiedCoreDownloadOperations,
} from './core-verified-download.js';

const BODY = Buffer.from('verified qortal jar bytes');

function digest(body = BODY) {
  return `sha256:${createHash('sha256').update(body).digest('hex')}`;
}

function asset(overrides: Partial<VerifiedCoreDownloadAsset> = {}): VerifiedCoreDownloadAsset {
  return {
    digest: digest(),
    downloadUrl: 'https://github.com/Qortal/qortal/releases/download/v6.1.9/qortal.jar',
    name: 'qortal.jar',
    size: BODY.length,
    ...overrides,
  };
}

async function withPaths(
  label: string,
  callback: (paths: { destination: string; partial: string; root: string }) => Promise<void>,
) {
  const root = mkdtempSync(path.join(os.tmpdir(), `qortium-home-${label}-`));
  const paths = {
    destination: path.join(root, 'qortal.jar'),
    partial: path.join(root, 'qortal.jar.operation.partial'),
    root,
  };

  try {
    await callback(paths);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function input(paths: { destination: string; partial: string }, overrides: Partial<VerifiedCoreDownloadAsset> = {}) {
  return {
    asset: asset(overrides),
    destinationPath: paths.destination,
    partialPath: paths.partial,
    userAgent: 'QortiumHome/test',
  };
}

function response(body: BodyInit | null = BODY, headers?: HeadersInit) {
  return new Response(body, { headers, status: 200 });
}

await withPaths('verified-download-success', async (paths) => {
  const progress: number[] = [];
  const result = await downloadVerifiedCoreAsset(
    {
      ...input(paths),
      onProgress: ({ percent }) => progress.push(percent),
    },
    { operations: { fetch: async () => response() } },
  );

  assert.deepEqual(result, { digest: digest(), size: BODY.length });
  assert.deepEqual(readFileSync(paths.destination), BODY);
  assert.equal(existsSync(paths.partial), false);
  assert.equal(progress.at(-1), 100);
});

await withPaths('verified-download-content-length', async (paths) => {
  await downloadVerifiedCoreAsset(input(paths), {
    operations: {
      fetch: async () => response(BODY, { 'content-length': String(BODY.length) }),
    },
  });

  assert.deepEqual(readFileSync(paths.destination), BODY);
});

for (const invalidAsset of [
  { digest: '' },
  { digest: digest().toUpperCase() },
  { digest: `sha512:${'a'.repeat(64)}` },
  { size: 0 },
  { size: -1 },
  { size: 1.5 },
  { size: Number.MAX_SAFE_INTEGER + 1 },
]) {
  await withPaths('verified-download-invalid-metadata', async (paths) => {
    let fetched = false;

    await assert.rejects(
      downloadVerifiedCoreAsset(input(paths, invalidAsset), {
        operations: {
          fetch: async () => {
            fetched = true;
            return response();
          },
        },
      }),
      /requires a canonical SHA-256 digest|requires a positive safe byte size/,
    );

    assert.equal(fetched, false);
    assert.equal(existsSync(paths.partial), false);
    assert.equal(existsSync(paths.destination), false);
  });
}

await withPaths('verified-download-path-alias', async (paths) => {
  let fetched = false;

  await assert.rejects(
    downloadVerifiedCoreAsset({
      ...input(paths),
      partialPath: path.join(paths.root, '.', 'qortal.jar'),
    }, {
      operations: {
        fetch: async () => {
          fetched = true;
          return response();
        },
      },
    }),
    /distinct partial and destination paths/i,
  );

  assert.equal(fetched, false);
  assert.equal(existsSync(paths.destination), false);
});

await withPaths('verified-download-cross-directory', async (paths) => {
  let fetched = false;

  await assert.rejects(
    downloadVerifiedCoreAsset({
      ...input(paths),
      partialPath: path.join(paths.root, 'other', 'qortal.jar.partial'),
    }, {
      operations: {
        fetch: async () => {
          fetched = true;
          return response();
        },
      },
    }),
    /must be direct siblings/i,
  );

  assert.equal(fetched, false);
});

await withPaths('verified-download-http-failure', async (paths) => {
  await assert.rejects(
    downloadVerifiedCoreAsset(input(paths), {
      operations: { fetch: async () => new Response('unavailable', { status: 503 }) },
    }),
    /HTTP 503/,
  );
  assert.equal(existsSync(paths.partial), false);
  assert.equal(existsSync(paths.destination), false);
});

await withPaths('verified-download-empty-response', async (paths) => {
  await assert.rejects(
    downloadVerifiedCoreAsset(input(paths), {
      operations: { fetch: async () => new Response(null, { status: 204 }) },
    }),
    /no response body/,
  );
  assert.equal(existsSync(paths.partial), false);
});

await withPaths('verified-download-content-length-mismatch', async (paths) => {
  await assert.rejects(
    downloadVerifiedCoreAsset(input(paths), {
      operations: { fetch: async () => response(BODY, { 'content-length': '1' }) },
    }),
    /Content-Length did not match/,
  );
  assert.equal(existsSync(paths.partial), false);
  assert.equal(existsSync(paths.destination), false);
});

for (const [label, body, expectedError] of [
  ['short', BODY.subarray(0, BODY.length - 1), /expected asset size/],
  ['oversize', Buffer.concat([BODY, Buffer.of(0)]), /exceeded the expected asset size/],
  ['wrong-digest', BODY, /expected SHA-256 digest/],
] as const) {
  await withPaths(`verified-download-${label}`, async (paths) => {
    const overrides = label === 'wrong-digest' ? { digest: `sha256:${'a'.repeat(64)}` } : {};

    await assert.rejects(
      downloadVerifiedCoreAsset(input(paths, overrides), {
        operations: { fetch: async () => response(body) },
      }),
      expectedError,
    );
    assert.equal(existsSync(paths.partial), false);
    assert.equal(existsSync(paths.destination), false);
  });
}

await withPaths('verified-download-stream-failure', async (paths) => {
  const streamError = new Error('stream interrupted');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(BODY.subarray(0, 5));
      controller.error(streamError);
    },
  });

  await assert.rejects(
    downloadVerifiedCoreAsset(input(paths), {
      operations: { fetch: async () => new Response(stream) },
    }),
    (error) => error === streamError,
  );
  assert.equal(existsSync(paths.partial), false);
  assert.equal(existsSync(paths.destination), false);
});

await withPaths('verified-download-write-failure', async (paths) => {
  const writeError = new Error('disk write failed');
  let removed = false;
  const operations: Partial<VerifiedCoreDownloadOperations> = {
    fetch: async () => response(),
    openExclusiveWriteStream: async () => new Writable({
      write(_chunk, _encoding, callback) {
        callback(writeError);
      },
    }),
    remove: async () => {
      removed = true;
    },
  };

  await assert.rejects(
    downloadVerifiedCoreAsset(input(paths), { operations }),
    (error) => error === writeError,
  );
  assert.equal(removed, true);
});

await withPaths('verified-download-exclusive-partial', async (paths) => {
  writeFileSync(paths.partial, 'another operation');

  await assert.rejects(
    downloadVerifiedCoreAsset(input(paths), { operations: { fetch: async () => response() } }),
    (error) => error instanceof Error && 'code' in error && error.code === 'EEXIST',
  );
  assert.equal(readFileSync(paths.partial, 'utf8'), 'another operation');
  assert.equal(existsSync(paths.destination), false);
});

await withPaths('verified-download-progress-failure', async (paths) => {
  const progressError = new Error('progress listener failed');

  await assert.rejects(
    downloadVerifiedCoreAsset({
      ...input(paths),
      onProgress: () => {
        throw progressError;
      },
    }, { operations: { fetch: async () => response() } }),
    (error) => error === progressError,
  );
  assert.equal(existsSync(paths.partial), false);
  assert.equal(existsSync(paths.destination), false);
});

await withPaths('verified-download-cleanup-failure', async (paths) => {
  const streamError = new Error('source failed');
  const cleanupError = new Error('cleanup failed');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(BODY.subarray(0, 1));
      controller.error(streamError);
    },
  });

  await assert.rejects(
    downloadVerifiedCoreAsset(input(paths), {
      operations: {
        fetch: async () => new Response(stream),
        remove: async () => {
          throw cleanupError;
        },
      },
    }),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0] === streamError &&
      error.errors[1] === cleanupError,
  );
});

await withPaths('verified-download-promote-after-verify', async (paths) => {
  let promoted = false;
  await assert.rejects(
    downloadVerifiedCoreAsset(input(paths, { digest: `sha256:${'b'.repeat(64)}` }), {
      operations: {
        fetch: async () => response(),
        promote: async () => {
          promoted = true;
        },
      },
    }),
    /expected SHA-256 digest/,
  );
  assert.equal(promoted, false);
  assert.equal(existsSync(paths.partial), false);
});

console.log('Verified Core asset download checks passed.');
