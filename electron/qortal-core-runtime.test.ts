import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CoreProcessSnapshot } from './core-process-observation.js';
import { createQortalCoreRuntimeOperations, type QortalCoreRuntimeOperations } from './qortal-core-runtime.js';
import type { QortalManagedInstallPaths } from './qortal-managed-install.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-qortal-runtime-'));
const installPath = path.join(root, 'install');
mkdirSync(installPath, { recursive: true });
const paths: QortalManagedInstallPaths = {
  apiKeyPath: path.join(installPath, 'apikey.txt'),
  backupJarPath: path.join(installPath, '.backup.jar'),
  basePath: root,
  candidateJarPath: path.join(installPath, '.candidate.jar'),
  currentMetadataPath: path.join(root, 'current.json'),
  installPath,
  jarPath: path.join(installPath, 'qortal.jar'),
  runtimePath: installPath,
  settingsPath: path.join(installPath, 'settings.json'),
};
const snapshot: CoreProcessSnapshot = {
  argv: ['java', '-jar', paths.jarPath, 'settings.json'],
  canonicalCwd: installPath,
  classification: { canonicalJarPath: paths.jarPath, kind: 'qortal-direct-jar',
    rawJarArgument: paths.jarPath, rawSettingsArgument: 'settings.json', selected: true },
  pid: 77,
  startIdentity: 'boot:100',
};
const buildTimestamp = '20260708200403';
const timestampSeconds = Math.floor(Date.UTC(2026, 6, 8, 20, 4, 3) / 1000);

function runtime(overrides: Partial<QortalCoreRuntimeOperations> = {}) {
  const calls: string[] = [];
  const operations: Partial<QortalCoreRuntimeOperations> = {
    fetchValue: async (url) => {
      calls.push(url);
      if (url.endsWith('/admin/info')) return { buildTimestamp: timestampSeconds,
        buildVersion: 'qortal-6.1.9-108bf191d4', isTestNet: false, nodeId: 'node', type: 'full' };
      if (url.endsWith('/admin/status')) return { height: 1, isMintingPossible: false,
        isSynchronizing: true, numberOfConnections: 0, numberOfDataConnections: 0 };
      if (url.endsWith('/admin/settings/apiKeyPath')) return installPath;
      if (url.endsWith('/admin/settings/localAuthBypassEnabled')) return false;
      if (url.endsWith('/admin/apikey/test') || url.endsWith('/admin/stop')) return true;
      if (url.endsWith('/admin/settings/autoUpdateEnabled')) return false;
      throw new Error(`unexpected URL ${url}`);
    },
    inspectListener: async () => ({ kind: 'owners', pids: [77] }),
    inspectProcesses: async () => ({ kind: 'observed', processes: [snapshot] }),
    readJarIdentity: async () => ({ buildTimestamp, buildVersion: '6.1.9-108bf191d4',
      commit: '108bf191d42d710ec617f535af30cfd82fc03c87', semver: '6.1.9' }),
    ...overrides,
  };
  return { calls, value: createQortalCoreRuntimeOperations(paths,
    async () => ({ command: '/java', source: 'managed' }), operations) };
}

try {
  writeFileSync(paths.settingsPath, '{}\n');
  writeFileSync(paths.apiKeyPath, '1111111111111111');
  chmodSync(paths.apiKeyPath, 0o600);

  {
    const { value } = runtime();
    const observed = await value.inspectRuntime();
    assert.equal(observed.state, 'running');
    if (observed.state === 'running') {
      assert.equal(observed.authority.readiness, 'ready');
      assert.equal(observed.authority.pid, 77);
      assert.equal(await value.readApiKey(paths, observed.authority), '1111111111111111');
      await value.stopWithApiKey({ apiKey: '1111111111111111', expectedAuthority: observed.authority,
        url: 'http://127.0.0.1:12391/admin/stop' });
    }
  }

  {
    let processReads = 0;
    let listenerReads = 0;
    const { value } = runtime({
      inspectListener: async () => { listenerReads += 1; return { kind: 'absent' }; },
      inspectProcesses: async () => { processReads += 1; return { kind: 'observed', processes: [] }; },
    });
    assert.deepEqual(await value.inspectRuntime(), { state: 'stopped' });
    assert.equal(processReads, 4);
    assert.equal(listenerReads, 2);
  }

  {
    const { value } = runtime({ inspectListener: async () => ({ kind: 'owners', pids: [88] }) });
    const observed = await value.inspectRuntime();
    assert.equal(observed.state, 'unknown');
  }

  {
    let reads = 0;
    const replaced = { ...snapshot, startIdentity: 'boot:101' };
    const { value } = runtime({ inspectProcesses: async () => {
      reads += 1;
      return { kind: 'observed', processes: [reads === 1 ? snapshot : replaced] };
    } });
    assert.equal((await value.inspectRuntime()).state, 'unknown',
      'a PID start-identity change across the listener bracket must revoke authority');
  }

  {
    let listenerReads = 0;
    const { value } = runtime({ inspectListener: async () => {
      listenerReads += 1;
      return { kind: 'owners', pids: listenerReads === 1 ? [77] : [77, 88] };
    } });
    assert.equal((await value.inspectRuntime()).state, 'unknown',
      'a listener co-holder appearing during API probes must revoke readiness');
  }

  {
    const helper: CoreProcessSnapshot = { ...snapshot, argv: ['java', 'org.qortal.ApplyBootstrap'],
      classification: { helper: 'apply-bootstrap', kind: 'qortal-updater-helper' }, pid: 78 };
    const { value } = runtime({ inspectListener: async () => ({ kind: 'absent' }),
      inspectProcesses: async () => ({ kind: 'observed', processes: [helper] }) });
    assert.equal((await value.inspectRuntime()).state, 'unknown');
  }

  {
    const helper: CoreProcessSnapshot = { ...snapshot, argv: ['java', 'org.qortal.ApplyUpdate'],
      classification: { helper: 'apply-update', kind: 'qortal-updater-helper' }, pid: 79 };
    let reads = 0;
    const { value } = runtime({ inspectProcesses: async () => {
      reads += 1;
      return { kind: 'observed', processes: reads <= 2 ? [snapshot] : [snapshot, helper] };
    } });
    assert.equal((await value.inspectRuntime()).state, 'unknown', 'a helper appearing during API probes must revoke readiness');
  }

  {
    writeFileSync(paths.apiKeyPath, '1111111111111111\n');
    const { value } = runtime();
    const observed = await value.inspectRuntime();
    assert.equal(observed.state, 'running');
    if (observed.state === 'running') assert.equal(await value.readApiKey(paths, observed.authority), null);
    writeFileSync(paths.apiKeyPath, '1111111111111111');
  }

  {
    chmodSync(paths.apiKeyPath, 0o644);
    const { value } = runtime();
    const observed = await value.inspectRuntime();
    assert.equal(observed.state, 'running');
    if (observed.state === 'running') assert.equal(await value.readApiKey(paths, observed.authority), null);
  }
} finally {
  rmSync(root, { force: true, recursive: true });
}

console.log('Production Qortal Core runtime authority checks passed.');
