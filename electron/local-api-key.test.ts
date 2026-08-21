import assert from 'node:assert/strict';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  QORTIUM_CORE_DESCRIPTOR,
  QORTAL_CORE_DESCRIPTOR,
  type CoreNetworkDescriptor,
} from './core-network-descriptor.js';
import {
  createRunningCoreApiKeyCache,
  deriveRunningCoreKeyFromProcessFiles,
  ensureLocalApiKey,
  getPreviewApiKeyPath,
  getRunningCoreApiKeyCacheKey,
  matchesRunningCoreApiKeyQuery,
  readLocalApiKey,
  readPreviewApiKey,
  type RunningCoreApiKeyQuery,
  type RunningCoreApiKeyResult,
} from './local-api-key.js';

function fileMode(filePath: string) {
  return lstatSync(filePath).mode & 0o777;
}

function runningResult(
  label: string,
  overrides: Partial<RunningCoreApiKeyResult> = {},
): RunningCoreApiKeyResult {
  return {
    apiKey: `${label}-key`,
    apiKeyDirectory: `/${label}/runtime`,
    created: false,
    cwd: `/${label}`,
    jarPath: `/${label}/${label}.jar`,
    path: `/${label}/runtime/apikey.txt`,
    pid: label === 'qortium' ? 101 : 202,
    settingsPath: `/${label}/settings.json`,
    ...overrides,
  };
}

const qortalDescriptor = {
  ...QORTIUM_CORE_DESCRIPTOR,
  id: 'qortal',
  label: 'Qortal',
  localApi: {
    ...QORTIUM_CORE_DESCRIPTOR.localApi,
    url: 'http://127.0.0.1:12391',
  },
  processProbe: {
    ...QORTIUM_CORE_DESCRIPTOR.processProbe,
    apiPort: 12391,
    jarNameMatcher: {
      caseInsensitive: true,
      kind: 'exact',
      value: 'qortal.jar',
    },
  },
} as const satisfies CoreNetworkDescriptor;

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'qortium-local-api-key-test-'));

try {
  const existingDirectory = path.join(tempRoot, 'existing');
  const existingPath = path.join(existingDirectory, 'apikey.txt');
  mkdirSync(existingDirectory, { recursive: true });
  writeFileSync(existingPath, '  existing-key\n', { encoding: 'utf8', mode: 0o644 });
  chmodSync(existingPath, 0o644);

  assert.deepEqual(readLocalApiKey(QORTIUM_CORE_DESCRIPTOR, existingDirectory), {
    apiKey: 'existing-key',
    created: false,
    path: existingPath,
  });
  assert.equal(
    fileMode(existingPath),
    0o644,
    'generic API-key reads must be non-mutating by default for adopted installs',
  );

  assert.deepEqual(readPreviewApiKey(existingDirectory), {
    apiKey: 'existing-key',
    created: false,
    path: existingPath,
  });
  if (process.platform !== 'win32') {
    assert.equal(fileMode(existingPath), 0o600, 'the legacy Qortium wrapper must retain chmod behavior');
  }
  assert.equal(getPreviewApiKeyPath(existingDirectory), existingPath);

  const generatedDirectory = path.join(tempRoot, 'generated');
  const generated = ensureLocalApiKey(QORTIUM_CORE_DESCRIPTOR, generatedDirectory);
  assert.equal(generated.created, true);
  assert.match(generated.apiKey, /^[1-9A-HJ-NP-Za-km-z]+$/);
  assert.equal(readFileSync(generated.path, 'utf8'), generated.apiKey);
  if (process.platform !== 'win32') {
    assert.equal(fileMode(generated.path), 0o600);
  }
  assert.deepEqual(ensureLocalApiKey(QORTIUM_CORE_DESCRIPTOR, generatedDirectory), {
    ...generated,
    created: false,
  });

  const processRoot = path.join(tempRoot, 'process');
  const installDirectory = path.join(processRoot, 'install');
  const runtimeDirectory = path.join(processRoot, 'runtime');
  const qortiumJarPath = path.join(installDirectory, 'Qortium-preview-2.1.JAR');
  const qortalJarPath = path.join(installDirectory, 'qortal.jar');
  const settingsPath = path.join(processRoot, 'settings-preview-local.json');
  mkdirSync(installDirectory, { recursive: true });
  mkdirSync(runtimeDirectory, { recursive: true });
  writeFileSync(qortiumJarPath, 'qortium jar');
  writeFileSync(qortalJarPath, 'qortal jar');
  writeFileSync(settingsPath, `${JSON.stringify({ apiKeyPath: 'runtime' })}\n`);
  writeFileSync(path.join(runtimeDirectory, 'apikey.txt'), 'process-key\n', { mode: 0o644 });
  chmodSync(path.join(runtimeDirectory, 'apikey.txt'), 0o644);

  const qortiumQuery: RunningCoreApiKeyQuery = {
    descriptor: QORTIUM_CORE_DESCRIPTOR,
    expectedApiKeyDirectory: runtimeDirectory,
    expectedJarPath: qortiumJarPath,
  };
  const qortiumProcess = deriveRunningCoreKeyFromProcessFiles(qortiumQuery, 303, {
    cwd: processRoot,
    files: [qortiumJarPath, settingsPath],
  });
  assert.equal(qortiumProcess?.apiKey, 'process-key');
  assert.equal(qortiumProcess?.jarPath, qortiumJarPath);
  assert.equal(qortiumProcess?.settingsPath, settingsPath);
  assert.equal(fileMode(path.join(runtimeDirectory, 'apikey.txt')), 0o644);

  assert.equal(
    deriveRunningCoreKeyFromProcessFiles(
      { ...qortiumQuery, expectedJarPath: qortalJarPath },
      303,
      { cwd: processRoot, files: [qortiumJarPath, settingsPath] },
    ),
    null,
    'a targeted lookup must fail closed for another canonical JAR',
  );
  assert.equal(
    deriveRunningCoreKeyFromProcessFiles(
      { ...qortiumQuery, expectedApiKeyDirectory: installDirectory },
      303,
      { cwd: processRoot, files: [qortiumJarPath, settingsPath] },
    ),
    null,
    'a targeted lookup must fail closed for another API-key directory',
  );

  assert.equal(
    deriveRunningCoreKeyFromProcessFiles(
      { descriptor: QORTIUM_CORE_DESCRIPTOR },
      404,
      { cwd: processRoot, files: [qortalJarPath, settingsPath] },
    ),
    null,
    'the Qortium probe must not accept qortal.jar',
  );
  assert.equal(
    deriveRunningCoreKeyFromProcessFiles(
      { descriptor: qortalDescriptor },
      405,
      { cwd: processRoot, files: [qortiumJarPath, settingsPath] },
    ),
    null,
    'the synthetic Qortal probe must not accept a Qortium JAR',
  );
  assert.equal(
    deriveRunningCoreKeyFromProcessFiles(
      { descriptor: qortalDescriptor, expectedJarPath: qortalJarPath },
      406,
      { cwd: processRoot, files: [qortalJarPath, settingsPath] },
    )?.apiKey,
    'process-key',
  );

  const qortalCwd = path.join(processRoot, 'qortal-cwd');
  mkdirSync(qortalCwd);
  writeFileSync(path.join(qortalCwd, 'settings.json'), '{}\n');
  writeFileSync(path.join(qortalCwd, 'apikey.txt'), 'qortal-process-key\n', { mode: 0o600 });
  assert.deepEqual(
    deriveRunningCoreKeyFromProcessFiles(
      {
        descriptor: QORTAL_CORE_DESCRIPTOR,
        expectedApiKeyDirectory: qortalCwd,
        expectedJarPath: qortalJarPath,
      },
      407,
      { cwd: qortalCwd, files: [qortalJarPath] },
    ),
    {
      apiKey: 'qortal-process-key',
      apiKeyDirectory: qortalCwd,
      created: false,
      cwd: qortalCwd,
      jarPath: qortalJarPath,
      path: path.join(qortalCwd, 'apikey.txt'),
      pid: 407,
      settingsPath: path.join(qortalCwd, 'settings.json'),
    },
    'the lsof fallback must resolve Qortal settings from the JVM cwd, not the JAR directory',
  );

  const qortiumJarLink = path.join(processRoot, 'qortium-link.jar');
  if (process.platform !== 'win32') {
    symlinkSync(qortiumJarPath, qortiumJarLink);
  }
  assert.equal(
    matchesRunningCoreApiKeyQuery(
      qortiumProcess as RunningCoreApiKeyResult,
      { descriptor: QORTIUM_CORE_DESCRIPTOR, expectedJarPath: qortiumJarLink },
      process.platform === 'win32'
        ? (value) =>
            value === qortiumJarPath || value === qortiumJarLink ? qortiumJarPath : path.resolve(value)
        : undefined,
    ),
    true,
    'canonical target matching must accept a symlink to the same JAR',
  );
  assert.equal(
    matchesRunningCoreApiKeyQuery(
      qortiumProcess as RunningCoreApiKeyResult,
      { descriptor: QORTIUM_CORE_DESCRIPTOR, expectedJarPath: path.join(processRoot, 'missing.jar') },
    ),
    false,
    'a missing expected target must fail closed',
  );

  const qortiumCacheQuery = { descriptor: QORTIUM_CORE_DESCRIPTOR };
  const qortalCacheQuery = { descriptor: qortalDescriptor };
  const targetedQortiumQuery = {
    descriptor: QORTIUM_CORE_DESCRIPTOR,
    expectedJarPath: qortiumJarPath,
  };
  assert.notEqual(
    getRunningCoreApiKeyCacheKey(qortiumCacheQuery),
    getRunningCoreApiKeyCacheKey(qortalCacheQuery),
  );
  assert.notEqual(
    getRunningCoreApiKeyCacheKey(qortiumCacheQuery),
    getRunningCoreApiKeyCacheKey(targetedQortiumQuery),
  );

  let now = 0;
  const syncCalls = new Map<string, number>();
  const syncValues = new Map([
    ['qortium', runningResult('qortium')],
    ['qortal', runningResult('qortal')],
  ]);
  const pendingRefreshes: Array<(value: RunningCoreApiKeyResult | null) => void> = [];
  const cache = createRunningCoreApiKeyCache({
    computeAsync: async () =>
      await new Promise<RunningCoreApiKeyResult | null>((resolve) => pendingRefreshes.push(resolve)),
    computeSync: (query) => {
      syncCalls.set(query.descriptor.id, (syncCalls.get(query.descriptor.id) ?? 0) + 1);
      return syncValues.get(query.descriptor.id) ?? null;
    },
    now: () => now,
    ttlMs: 5,
  });

  assert.equal(cache.read(qortiumCacheQuery)?.apiKey, 'qortium-key');
  assert.equal(cache.read(qortalCacheQuery)?.apiKey, 'qortal-key');
  assert.deepEqual(Object.fromEntries(syncCalls), { qortal: 1, qortium: 1 });
  assert.equal(cache.read(qortiumCacheQuery)?.apiKey, 'qortium-key');
  assert.equal(syncCalls.get('qortium'), 1);

  cache.invalidate(qortiumCacheQuery);
  syncValues.set('qortium', runningResult('qortium-new'));
  assert.equal(cache.read(qortiumCacheQuery)?.apiKey, 'qortium-new-key');
  assert.equal(cache.read(qortalCacheQuery)?.apiKey, 'qortal-key');
  assert.equal(syncCalls.get('qortium'), 2);
  assert.equal(syncCalls.get('qortal'), 1);

  cache.invalidateNetwork('qortium');
  assert.equal(cache.read(qortiumCacheQuery)?.apiKey, 'qortium-new-key');
  assert.equal(cache.read(qortalCacheQuery)?.apiKey, 'qortal-key');
  assert.equal(syncCalls.get('qortium'), 3);
  assert.equal(syncCalls.get('qortal'), 1);

  now = 10;
  assert.equal(cache.read(qortiumCacheQuery)?.apiKey, 'qortium-new-key');
  assert.equal(pendingRefreshes.length, 1);
  cache.invalidate(qortiumCacheQuery);
  syncValues.set('qortium', runningResult('qortium-fresh'));
  assert.equal(cache.read(qortiumCacheQuery)?.apiKey, 'qortium-fresh-key');
  pendingRefreshes.shift()?.(runningResult('qortium-stale'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    cache.read(qortiumCacheQuery)?.apiKey,
    'qortium-fresh-key',
    'an invalidated in-flight refresh must not repopulate stale state',
  );

  console.log('local API-key descriptor, target, file, and cache tests passed');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
