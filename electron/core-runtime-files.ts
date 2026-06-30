import { existsSync } from 'node:fs';
import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

function normalizeFilesystemPath(value: string) {
  return path.resolve(value);
}

export async function copyLegacyInstallListsToRuntime(previewPath: string, runtimePath: string) {
  const legacyListsPath = path.join(previewPath, 'lists');
  const targetListsPath = path.join(runtimePath, 'lists');

  if (
    !existsSync(legacyListsPath) ||
    normalizeFilesystemPath(legacyListsPath) === normalizeFilesystemPath(targetListsPath)
  ) {
    return;
  }

  const entries = await readdir(legacyListsPath, { withFileTypes: true });

  if (entries.length === 0) {
    return;
  }

  await mkdir(targetListsPath, { recursive: true });

  for (const entry of entries) {
    const sourceEntryPath = path.join(legacyListsPath, entry.name);
    const targetEntryPath = path.join(targetListsPath, entry.name);

    if (existsSync(targetEntryPath)) {
      continue;
    }

    await cp(sourceEntryPath, targetEntryPath, { recursive: entry.isDirectory() });
  }
}
