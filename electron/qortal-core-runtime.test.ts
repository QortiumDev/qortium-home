import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CoreProcessSnapshot } from './core-process-observation.js';
import type { QortalRuntimeTarget } from './qortal-core-manager.js';
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
const target: QortalRuntimeTarget = {
  installPath: paths.installPath,
  jarPath: paths.jarPath,
  owner: 'home-managed',
};
function sameTarget(left: QortalRuntimeTarget, right: QortalRuntimeTarget) {
  return left.owner === right.owner && path.resolve(left.installPath) === path.resolve(right.installPath) &&
    path.resolve(left.jarPath) === path.resolve(right.jarPath);
}
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

function runtime(
  overrides: Partial<QortalCoreRuntimeOperations> = {},
) {
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
  return { calls, value: createQortalCoreRuntimeOperations(
    async () => ({ command: '/java', source: 'managed' }), operations) };
}

try {
  writeFileSync(paths.settingsPath, '{}\n');
  writeFileSync(paths.apiKeyPath, '1111111111111111');
  chmodSync(paths.apiKeyPath, 0o600);

  {
    const adoptedInstallPath = path.join(root, 'adopted');
    mkdirSync(adoptedInstallPath, { recursive: true });
    const adoptedTarget: QortalRuntimeTarget = {
      installPath: adoptedInstallPath,
      jarPath: path.join(adoptedInstallPath, 'qortal.jar'),
      owner: 'external',
    };
    writeFileSync(path.join(adoptedInstallPath, 'settings.json'), '{}\n');
    writeFileSync(path.join(adoptedInstallPath, 'apikey.txt'), '1111111111111111');
    chmodSync(path.join(adoptedInstallPath, 'apikey.txt'), 0o600);
    const adoptedSnapshot: CoreProcessSnapshot = {
      ...snapshot,
      argv: ['java', '-jar', adoptedTarget.jarPath, 'settings.json'],
      canonicalCwd: adoptedInstallPath,
      classification: { canonicalJarPath: adoptedTarget.jarPath, kind: 'qortal-direct-jar',
        rawJarArgument: adoptedTarget.jarPath, rawSettingsArgument: 'settings.json', selected: true },
    };
    const inspectedTargets: string[] = [];
    const adoptedFetchCalls: string[] = [];
    const { value } = runtime({
      fetchValue: async (url) => {
        adoptedFetchCalls.push(url);
        if (url.endsWith('/admin/info')) return { buildTimestamp: timestampSeconds,
          buildVersion: 'qortal-6.1.9-108bf191d4', isTestNet: false, nodeId: 'node', type: 'full' };
        if (url.endsWith('/admin/status')) return { height: 1, isMintingPossible: false,
          isSynchronizing: true, numberOfConnections: 0, numberOfDataConnections: 0 };
        if (url.endsWith('/admin/settings/apiKeyPath')) return adoptedInstallPath;
        if (url.endsWith('/admin/settings/localAuthBypassEnabled')) return false;
        if (url.endsWith('/admin/apikey/test') || url.endsWith('/admin/stop')) return true;
        if (url.endsWith('/admin/settings/autoUpdateEnabled')) return false;
        throw new Error(`unexpected adopted URL ${url}`);
      },
      inspectProcesses: async (selected) => {
        inspectedTargets.push(selected.jarPath);
        return { kind: 'observed', processes: [sameTarget(selected, adoptedTarget) ? adoptedSnapshot : snapshot] };
      },
    });
    const observed = await value.inspectRuntime(adoptedTarget);
    assert.equal(observed.state, 'running');
    if (observed.state === 'running') {
      assert.equal(observed.authority.owner, 'external');
      assert.equal(observed.authority.canonicalJarPath, adoptedTarget.jarPath);
      const apiKey = await value.readApiKey(adoptedTarget, observed.authority);
      assert.equal(apiKey, '1111111111111111');
      await value.stopWithApiKey({ apiKey: apiKey!, expectedAuthority: observed.authority,
        target: adoptedTarget, url: 'http://127.0.0.1:12391/admin/stop' });
      assert.equal(adoptedFetchCalls.some((url) => url.endsWith('/admin/stop')), true,
        'an adopted runtime must be stopped through its validated API authority');
      await assert.rejects(value.stopWithApiKey({ apiKey: apiKey!,
        expectedAuthority: { ...observed.authority, startIdentity: 'replacement-process' },
        target: adoptedTarget, url: 'http://127.0.0.1:12391/admin/stop' }), /authority changed/i);
    }
    assert.equal(inspectedTargets.every((value) => value === adoptedTarget.jarPath), true,
      'every authority bracket must use the selected adopted JAR');
  }

  {
    const { value } = runtime();
    const observed = await value.inspectRuntime(target);
    assert.equal(observed.state, 'running');
    if (observed.state === 'running') {
      assert.equal(observed.authority.readiness, 'ready');
      assert.equal(observed.authority.pid, 77);
      assert.equal(await value.readApiKey(target, observed.authority), '1111111111111111');
      await value.stopWithApiKey({ apiKey: '1111111111111111', expectedAuthority: observed.authority,
        target, url: 'http://127.0.0.1:12391/admin/stop' });
    }
  }

  {
    const aliasInstallPath = path.join(root, 'install-alias');
    symlinkSync(installPath, aliasInstallPath, 'dir');
    const aliasedTarget: QortalRuntimeTarget = {
      installPath: aliasInstallPath,
      jarPath: path.join(aliasInstallPath, 'qortal.jar'),
      owner: 'home-managed',
    };
    const observed = await runtime().value.inspectRuntime(aliasedTarget);
    assert.equal(observed.state, 'running',
      'canonical observed paths must remain authoritative through a managed-path symlink ancestor');
  }

  {
    let processReads = 0;
    let listenerReads = 0;
    const { value } = runtime({
      inspectListener: async () => { listenerReads += 1; return { kind: 'absent' }; },
      inspectProcesses: async () => { processReads += 1; return { kind: 'observed', processes: [] }; },
    });
    assert.deepEqual(await value.inspectRuntime(target), { state: 'stopped' });
    assert.equal(processReads, 4);
    assert.equal(listenerReads, 2);
  }

  {
    const { value } = runtime({ inspectListener: async () => ({ kind: 'owners', pids: [88] }) });
    const observed = await value.inspectRuntime(target);
    assert.equal(observed.state, 'unknown');
  }

  {
    let reads = 0;
    const replaced = { ...snapshot, startIdentity: 'boot:101' };
    const { value } = runtime({ inspectProcesses: async () => {
      reads += 1;
      return { kind: 'observed', processes: [reads === 1 ? snapshot : replaced] };
    } });
    assert.equal((await value.inspectRuntime(target)).state, 'unknown',
      'a PID start-identity change across the listener bracket must revoke authority');
  }

  {
    let listenerReads = 0;
    const { value } = runtime({ inspectListener: async () => {
      listenerReads += 1;
      return { kind: 'owners', pids: listenerReads === 1 ? [77] : [77, 88] };
    } });
    assert.equal((await value.inspectRuntime(target)).state, 'unknown',
      'a listener co-holder appearing during API probes must revoke readiness');
  }

  {
    const helper: CoreProcessSnapshot = { ...snapshot, argv: ['java', 'org.qortal.ApplyBootstrap'],
      classification: { helper: 'apply-bootstrap', kind: 'qortal-updater-helper' }, pid: 78 };
    const { value } = runtime({ inspectListener: async () => ({ kind: 'absent' }),
      inspectProcesses: async () => ({ kind: 'observed', processes: [helper] }) });
    assert.equal((await value.inspectRuntime(target)).state, 'unknown');
  }

  {
    const helper: CoreProcessSnapshot = { ...snapshot, argv: ['java', 'org.qortal.ApplyUpdate'],
      classification: { helper: 'apply-update', kind: 'qortal-updater-helper' }, pid: 79 };
    let reads = 0;
    const { value } = runtime({ inspectProcesses: async () => {
      reads += 1;
      return { kind: 'observed', processes: reads <= 2 ? [snapshot] : [snapshot, helper] };
    } });
    assert.equal((await value.inspectRuntime(target)).state, 'unknown', 'a helper appearing during API probes must revoke readiness');
  }

  {
    writeFileSync(paths.apiKeyPath, '1111111111111111\n');
    const { value } = runtime();
    const observed = await value.inspectRuntime(target);
    assert.equal(observed.state, 'running');
    if (observed.state === 'running') assert.equal(await value.readApiKey(target, observed.authority), null);
    writeFileSync(paths.apiKeyPath, '1111111111111111');
  }

  {
    chmodSync(paths.apiKeyPath, 0o644);
    const { value } = runtime();
    const observed = await value.inspectRuntime(target);
    assert.equal(observed.state, 'running');
    if (observed.state === 'running') assert.equal(await value.readApiKey(target, observed.authority), null);
  }
} finally {
  rmSync(root, { force: true, recursive: true });
}

console.log('Production Qortal Core runtime authority checks passed.');
