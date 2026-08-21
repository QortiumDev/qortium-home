import { stat } from 'node:fs/promises';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { getCoreSemver } from './core-version.js';

export type CoreJarIdentity = {
  buildTimestamp: string;
  buildVersion: string;
  commit: string;
  semver: string;
};

type CacheEntry = {
  identity: CoreJarIdentity | null;
  key: string;
};

const identityCache = new Map<string, CacheEntry>();
const TARGET_ENTRIES = new Set(['build.properties', 'git.properties']);
const MAX_PROPERTIES_BYTES = 128 * 1024;

function parseProperties(value: string) {
  const properties = new Map<string, string>();

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#') || line.startsWith('!')) {
      continue;
    }

    const separatorIndex = line.search(/[:=]/);

    if (separatorIndex < 0) {
      continue;
    }

    properties.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
  }

  return properties;
}

function openZip(jarPath: string) {
  return new Promise<ZipFile>((resolve, reject) => {
    yauzl.open(jarPath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error('Unable to open Core jar.'));
        return;
      }

      resolve(zipFile);
    });
  });
}

function readEntry(zipFile: ZipFile, entry: Entry) {
  return new Promise<string>((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error(`Unable to read ${entry.fileName}.`));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;

      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;

        if (size <= MAX_PROPERTIES_BYTES) {
          chunks.push(chunk);
        }
      });
      stream.on('error', reject);
      stream.on('end', () => {
        if (size > MAX_PROPERTIES_BYTES) {
          reject(new Error(`${entry.fileName} is unexpectedly large.`));
          return;
        }

        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
  });
}

async function readTargetEntries(jarPath: string) {
  const zipFile = await openZip(jarPath);

  return await new Promise<Map<string, string>>((resolve, reject) => {
    const values = new Map<string, string>();
    let settled = false;

    const finish = (error?: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      zipFile.close();

      if (error) {
        reject(error);
      } else {
        resolve(values);
      }
    };

    zipFile.on('error', finish);
    zipFile.on('end', () => finish());
    zipFile.on('entry', (entry: Entry) => {
      if (!TARGET_ENTRIES.has(entry.fileName)) {
        zipFile.readEntry();
        return;
      }

      void readEntry(zipFile, entry)
        .then((value) => {
          values.set(entry.fileName, value);

          if (values.size === TARGET_ENTRIES.size) {
            finish();
          } else {
            zipFile.readEntry();
          }
        })
        .catch(finish);
    });

    zipFile.readEntry();
  });
}

async function readIdentity(jarPath: string): Promise<CoreJarIdentity | null> {
  const entries = await readTargetEntries(jarPath);
  const buildPropertiesValue = entries.get('build.properties');

  if (!buildPropertiesValue) {
    return null;
  }

  const buildProperties = parseProperties(buildPropertiesValue);
  const gitProperties = parseProperties(entries.get('git.properties') ?? '');
  const buildVersion = buildProperties.get('build.version')?.trim() ?? '';
  const semver = getCoreSemver(buildVersion) ?? '';
  const versionCommit = /-([0-9a-f]{6,40})$/i.exec(buildVersion)?.[1] ?? '';
  const commit = gitProperties.get('git.commit.id.full')?.trim() || versionCommit;

  if (!buildVersion || !semver) {
    return null;
  }

  return {
    buildTimestamp: buildProperties.get('build.timestamp')?.trim() ?? '',
    buildVersion,
    commit,
    semver,
  };
}

export async function readCoreJarIdentityUncached(
  jarPath: string,
): Promise<CoreJarIdentity | null> {
  return await readIdentity(jarPath).catch(() => null);
}

export async function readCoreJarIdentity(jarPath: string): Promise<CoreJarIdentity | null> {
  try {
    const jarStat = await stat(jarPath);
    const key = `${jarPath}\0${jarStat.dev}\0${jarStat.ino}\0${jarStat.mtimeMs}\0${jarStat.size}`;
    const cached = identityCache.get(jarPath);

    if (cached?.key === key) {
      return cached.identity;
    }

    const identity = await readCoreJarIdentityUncached(jarPath);

    identityCache.set(jarPath, { identity, key });
    return identity;
  } catch {
    identityCache.delete(jarPath);
    return null;
  }
}
