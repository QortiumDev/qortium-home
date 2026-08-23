import { createHash } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const CANONICAL_SHA256 = /^sha256:[a-f0-9]{64}$/;
const CANONICAL_CONTENT_LENGTH = /^(0|[1-9][0-9]*)$/;

export type VerifiedCoreDownloadAsset = Readonly<{
  digest: string;
  downloadUrl: string;
  name: string;
  size: number;
}>;

export type VerifiedCoreDownloadProgress = Readonly<{
  expectedBytes: number;
  percent: number;
  receivedBytes: number;
}>;

export type VerifiedCoreDownloadOperations = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  openExclusiveWriteStream: (targetPath: string) => Promise<Writable>;
  promote: (sourcePath: string, destinationPath: string) => Promise<void>;
  remove: (targetPath: string) => Promise<void>;
};

export type VerifiedCoreDownloadInput = {
  asset: VerifiedCoreDownloadAsset;
  destinationPath: string;
  onProgress?: (progress: VerifiedCoreDownloadProgress) => void;
  partialPath: string;
  userAgent: string;
};

const DEFAULT_OPERATIONS: VerifiedCoreDownloadOperations = {
  fetch: async (url, init) => await fetch(url, init),
  openExclusiveWriteStream: async (targetPath) => {
    // Acquire the path before returning a stream so failure with EEXIST never
    // gives this operation ownership of (or cleanup rights over) another
    // operation's partial download.
    const handle = await open(targetPath, 'wx', 0o600);

    try {
      return handle.createWriteStream({ autoClose: true });
    } catch (error) {
      await handle.close().catch(() => {});
      throw error;
    }
  },
  promote: rename,
  remove: async (targetPath) => {
    await rm(targetPath, { force: true });
  },
};

function failure(value: unknown) {
  return value instanceof Error ? value : new Error(String(value));
}

function validateInput(input: VerifiedCoreDownloadInput) {
  if (!CANONICAL_SHA256.test(input.asset.digest)) {
    throw new Error(`The ${input.asset.name || 'Core asset'} download requires a canonical SHA-256 digest.`);
  }

  if (!Number.isSafeInteger(input.asset.size) || input.asset.size <= 0) {
    throw new Error(`The ${input.asset.name || 'Core asset'} download requires a positive safe byte size.`);
  }

  if (!input.destinationPath || !input.partialPath) {
    throw new Error('Verified Core downloads require distinct partial and destination paths.');
  }

  const destinationPath = path.resolve(input.destinationPath);
  const partialPath = path.resolve(input.partialPath);
  const comparePath = (targetPath: string) =>
    process.platform === 'win32' ? targetPath.toLowerCase() : targetPath;

  if (comparePath(destinationPath) === comparePath(partialPath)) {
    throw new Error('Verified Core downloads require distinct partial and destination paths.');
  }

  if (comparePath(path.dirname(destinationPath)) !== comparePath(path.dirname(partialPath))) {
    throw new Error('Verified Core download partial and destination paths must be direct siblings.');
  }

  return { destinationPath, partialPath };
}

function validateContentLength(response: Response, expectedBytes: number, assetName: string) {
  const rawLength = response.headers.get('content-length');

  if (rawLength === null) {
    return;
  }

  if (!CANONICAL_CONTENT_LENGTH.test(rawLength)) {
    throw new Error(`The ${assetName} download returned an invalid Content-Length.`);
  }

  const contentLength = Number(rawLength);

  if (!Number.isSafeInteger(contentLength) || contentLength !== expectedBytes) {
    throw new Error(`The ${assetName} download Content-Length did not match the expected asset size.`);
  }
}

async function removeOwnedPartial(
  partialPath: string,
  originalError: unknown,
  operations: VerifiedCoreDownloadOperations,
) {
  try {
    await operations.remove(partialPath);
  } catch (cleanupError) {
    throw new AggregateError(
      [failure(originalError), failure(cleanupError)],
      'The verified Core download failed and its partial file could not be removed.',
    );
  }
}

/**
 * Streams one release asset into an operation-owned partial file and promotes
 * it only after both the observed byte count and SHA-256 digest match trusted
 * release metadata. This module deliberately has no Electron or IPC surface.
 */
export async function downloadVerifiedCoreAsset(
  input: VerifiedCoreDownloadInput,
  options: { operations?: Partial<VerifiedCoreDownloadOperations> } = {},
) {
  const paths = validateInput(input);

  const operations: VerifiedCoreDownloadOperations = {
    ...DEFAULT_OPERATIONS,
    ...options.operations,
  };
  const response = await operations.fetch(input.asset.downloadUrl, {
    headers: {
      Accept: 'application/octet-stream,*/*',
      'User-Agent': input.userAgent,
    },
  });

  if (!response.ok) {
    throw new Error(`${input.asset.name} download failed with HTTP ${response.status}.`);
  }

  if (!response.body) {
    throw new Error(`${input.asset.name} download returned no response body.`);
  }

  validateContentLength(response, input.asset.size, input.asset.name);

  let ownsPartial = false;

  try {
    const destination = await operations.openExclusiveWriteStream(paths.partialPath);
    ownsPartial = true;
    const hash = createHash('sha256');
    let receivedBytes = 0;
    const verifier = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.length;

        if (receivedBytes > input.asset.size) {
          callback(new Error(`${input.asset.name} download exceeded the expected asset size.`));
          return;
        }

        hash.update(chunk);

        try {
          input.onProgress?.({
            expectedBytes: input.asset.size,
            percent: Math.floor((receivedBytes / input.asset.size) * 100),
            receivedBytes,
          });
        } catch (error) {
          callback(failure(error));
          return;
        }

        callback(null, chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      verifier,
      destination,
    );

    if (receivedBytes !== input.asset.size) {
      throw new Error(`${input.asset.name} download did not match the expected asset size.`);
    }

    const digest = `sha256:${hash.digest('hex')}`;

    if (digest !== input.asset.digest) {
      throw new Error(`${input.asset.name} download did not match the expected SHA-256 digest.`);
    }

    await operations.promote(paths.partialPath, paths.destinationPath);
    ownsPartial = false;

    return { digest, size: receivedBytes };
  } catch (error) {
    if (ownsPartial) {
      await removeOwnedPartial(paths.partialPath, error, operations);
    }

    throw error;
  }
}
