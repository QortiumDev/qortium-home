import { readdir, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Temp directories the QDN preview stager owns.
 *
 * Extracted from qdn.ts so the bookkeeping can be tested without loading the
 * whole 1.x QDN module (and Electron with it). The behaviour is unchanged
 * except where noted below.
 */
export const QDN_PREVIEW_STAGING_PREFIX = 'qortium-home-preview-';

/**
 * How many staged previews may be remembered at once.
 *
 * The map exists so previewing the SAME source twice replaces its directory
 * instead of leaking it, which is a 1.x behaviour: 1.x previews the user's own
 * path, so the key repeats. Home 2 never repeats it - every preview stages a
 * fresh mkdtemp copy first and hands the stager THAT path - so the reuse
 * branch never fires and each PREVIEW_QDN_PUBLISH_SOURCE call, an action any
 * app may make without a permission prompt, added an entry that lived as long
 * as the process. Home 2 now releases its entry when it removes the directory,
 * and this bound is the backstop for anything that forgets to.
 */
export const QDN_PREVIEW_STAGING_MAX_TRACKED = 32;

const qdnPreviewStagingDirs = new Map<string, string>();

async function removeStagingDir(stagingDir: string) {
  await rm(stagingDir, { force: true, recursive: true }).catch(() => undefined);
}

/**
 * Track a staging directory against the source path it was made for, evicting
 * the directory that key held before and, past the bound, the oldest keys.
 *
 * The caller creates the directory: this module does not, so a test can prove
 * the bookkeeping without touching the disk.
 */
export async function trackQdnPreviewStagingDir(sourcePath: string, stagingDir: string) {
  const previousDir = qdnPreviewStagingDirs.get(sourcePath);

  if (previousDir && previousDir !== stagingDir) {
    // Deleted BEFORE the await, so a second preview of the same source cannot
    // observe (and re-delete) a directory this call has already given up.
    qdnPreviewStagingDirs.delete(sourcePath);
    await removeStagingDir(previousDir);
  }

  qdnPreviewStagingDirs.set(sourcePath, stagingDir);

  while (qdnPreviewStagingDirs.size > QDN_PREVIEW_STAGING_MAX_TRACKED) {
    // Map iterates in insertion order, so this is the oldest tracked preview.
    const oldest = qdnPreviewStagingDirs.keys().next();

    if (oldest.done || oldest.value === sourcePath) {
      break;
    }

    const evicted = qdnPreviewStagingDirs.get(oldest.value);

    qdnPreviewStagingDirs.delete(oldest.value);

    if (evicted) {
      await removeStagingDir(evicted);
    }
  }

  return stagingDir;
}

/**
 * Forget a staging directory whoever created it has already removed.
 *
 * Home 2's preview removes its staged copies itself, in a `finally`, so the
 * entry must go with them: otherwise the on-disk cleanup succeeds and the map
 * keeps growing. Returns whether an entry was found, which is what the test
 * asserts on.
 */
export function releaseQdnPreviewStagingDir(stagingDir: string) {
  for (const [sourcePath, tracked] of qdnPreviewStagingDirs) {
    if (tracked === stagingDir) {
      qdnPreviewStagingDirs.delete(sourcePath);

      return true;
    }
  }

  return false;
}

/** How many staging directories are currently tracked. Exported for tests. */
export function countTrackedQdnPreviewStagingDirs() {
  return qdnPreviewStagingDirs.size;
}

// Preview staging dirs are otherwise only replaced when the same source path is
// previewed again, so distinct previews accumulate for the process lifetime.
// Called from the app quit path; sync so the quit cannot outrun the cleanup.
export function cleanupQdnPreviewStagingDirs() {
  for (const stagingDir of qdnPreviewStagingDirs.values()) {
    try {
      rmSync(stagingDir, { force: true, recursive: true });
    } catch {
      // Best effort on quit; the startup sweep collects anything left behind.
    }
  }

  qdnPreviewStagingDirs.clear();
}

// Collect staging dirs orphaned by crashed/killed sessions. Only called after
// the single-instance lock is held, so no other Home instance can be using them.
export async function sweepOrphanedQdnPreviewStagingDirs() {
  let entries: string[];

  try {
    entries = await readdir(os.tmpdir());
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(QDN_PREVIEW_STAGING_PREFIX))
      .map((entry) => removeStagingDir(path.join(os.tmpdir(), entry))),
  );
}
