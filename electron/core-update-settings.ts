import { app } from 'electron';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CORE_DATA_DIR = 'qortium-core';
const UPDATE_SETTINGS_FILE = 'update-settings.json';
const LEGACY_JAVA_SETTINGS_FILE = 'java-settings.json';

export type CoreUpdatePolicy = 'install' | 'notify' | 'off';

export type CoreUpdateSettings = {
  coreUpdatePolicy: CoreUpdatePolicy;
  javaUpdatePolicy: CoreUpdatePolicy;
};

const DEFAULT_UPDATE_SETTINGS: CoreUpdateSettings = {
  coreUpdatePolicy: 'notify',
  javaUpdatePolicy: 'notify',
};

let settingsWriteQueue: Promise<void> = Promise.resolve();

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function normalizePolicy(value: unknown): CoreUpdatePolicy {
  return value === 'install' || value === 'notify' || value === 'off' ? value : 'notify';
}

function getCoreBasePath() {
  return path.join(app.getPath('appData'), CORE_DATA_DIR);
}

function getUpdateSettingsPath() {
  return path.join(getCoreBasePath(), UPDATE_SETTINGS_FILE);
}

function getLegacyJavaSettingsPath() {
  return path.join(getCoreBasePath(), 'java', LEGACY_JAVA_SETTINGS_FILE);
}

async function writeSettingsAtomically(settings: Record<string, unknown>) {
  await mkdir(getCoreBasePath(), { recursive: true });
  const settingsPath = getUpdateSettingsPath();
  const temporaryPath = `${settingsPath}.qortium-home-${process.pid}-${Date.now()}.tmp`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, settingsPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function queueSettingsWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = settingsWriteQueue.then(operation, operation);

  settingsWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );

  return result;
}

async function readSettingsFile(): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(getUpdateSettingsPath(), 'utf8'));

    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeSettings(settings: Record<string, unknown>): CoreUpdateSettings {
  return {
    coreUpdatePolicy: normalizePolicy(settings.coreUpdatePolicy),
    javaUpdatePolicy: normalizePolicy(settings.javaUpdatePolicy),
  };
}

async function readLegacyJavaPolicy(): Promise<CoreUpdatePolicy> {
  try {
    const parsed: unknown = JSON.parse(await readFile(getLegacyJavaSettingsPath(), 'utf8'));

    return isObject(parsed) && parsed.autoUpdate === true ? 'install' : 'notify';
  } catch {
    return 'notify';
  }
}

export async function readCoreUpdateSettings(): Promise<CoreUpdateSettings> {
  const parsed = await readSettingsFile();

  if (parsed) {
    return normalizeSettings(parsed);
  }

  // Serialize migration with policy changes. Re-read in the critical section
  // so a concurrent setter always wins over this default-file creation.
  return await queueSettingsWrite(async () => {
    const current = await readSettingsFile();

    if (current) {
      return normalizeSettings(current);
    }

    const settings: CoreUpdateSettings = {
      ...DEFAULT_UPDATE_SETTINGS,
      javaUpdatePolicy: await readLegacyJavaPolicy(),
    };

    await writeSettingsAtomically(settings);
    return settings;
  });
}

export async function setCoreUpdateSettings(request: {
  coreUpdatePolicy?: unknown;
  javaUpdatePolicy?: unknown;
}) {
  return await queueSettingsWrite(async () => {
    const onDisk = await readSettingsFile();
    const current = onDisk
      ? normalizeSettings(onDisk)
      : {
          ...DEFAULT_UPDATE_SETTINGS,
          javaUpdatePolicy: await readLegacyJavaPolicy(),
        };
    const settings: CoreUpdateSettings = {
      coreUpdatePolicy:
        request.coreUpdatePolicy === undefined
          ? current.coreUpdatePolicy
          : normalizePolicy(request.coreUpdatePolicy),
      javaUpdatePolicy:
        request.javaUpdatePolicy === undefined
          ? current.javaUpdatePolicy
          : normalizePolicy(request.javaUpdatePolicy),
    };

    await writeSettingsAtomically({ ...(onDisk ?? {}), ...settings });
    return settings;
  });
}
