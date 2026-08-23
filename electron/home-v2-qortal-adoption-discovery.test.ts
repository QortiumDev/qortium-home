import assert from 'node:assert/strict'
import type { CoreProcessObservation } from './core-process-observation.js'
import type { QortalCoreManager } from './qortal-core-manager.js'
import { HomeV2QortalAdoptionDiscoveryService } from './home-v2-qortal-adoption-discovery.js'
import type { QortalInstallCandidate, QortalInstallCandidateHint } from './qortal-install-source.js'

const PATHS = {
  basePath: '/app/qortal-core',
  candidateJarPath: '/app/qortal-core/install/candidate.jar',
  currentMetadataPath: '/app/qortal-core/current.json',
  installPath: '/app/qortal-core/install',
  jarPath: '/app/qortal-core/install/qortal.jar',
  javaPath: '/app/qortal-core/java',
  partialPath: '/app/qortal-core/install/qortal.jar.partial',
  settingsPath: '/app/qortal-core/install/settings.json',
} as const

const manager = { config: { paths: PATHS }, networkId: 'qortal' } as unknown as QortalCoreManager

function candidate(installPath: string, origins: QortalInstallCandidate['origins']): QortalInstallCandidate {
  return {
    canonicalInstallPath: installPath,
    hubHint: origins.includes('qortal-hub'),
    jarState: {
      canonicalPath: `${installPath}/qortal.jar`,
      dev: 1,
      identity: { buildTimestamp: '1', buildVersion: '6.2.0', commit: 'a'.repeat(40), semver: '6.2.0' },
      ino: 2,
      kind: 'file',
      mtimeMs: 3,
      sha256: `sha256:${'a'.repeat(64)}`,
      size: 4,
    },
    origins,
    runningProcessMatch: origins.includes('running-process'),
    settingsState: {
      canonicalPath: `${installPath}/settings.json`,
      dev: 1,
      ino: 3,
      mtimeMs: 4,
      sha256: `sha256:${'b'.repeat(64)}`,
      size: 5,
    },
  }
}

const observedProcesses: CoreProcessObservation = {
  kind: 'observed',
  processes: [{
    argv: ['java', '-jar', '/running/qortal.jar', 'settings.json'],
    canonicalCwd: '/running',
    classification: {
      canonicalJarPath: '/running/qortal.jar',
      kind: 'qortal-direct-jar',
      rawJarArgument: '/running/qortal.jar',
      rawSettingsArgument: 'settings.json',
      selected: false,
    },
    pid: 42,
    startIdentity: 'opaque',
  }, {
    argv: ['java', '-jar', '/wrong/qortal.jar'],
    canonicalCwd: '/other',
    classification: {
      canonicalJarPath: '/wrong/qortal.jar',
      kind: 'qortal-direct-jar',
      rawJarArgument: '/wrong/qortal.jar',
      rawSettingsArgument: null,
      selected: false,
    },
    pid: 43,
    startIdentity: 'opaque-2',
  }],
}

{
  let collected = 0
  let discovered = 0
  let received: readonly QortalInstallCandidateHint[] = []
  const service = new HomeV2QortalAdoptionDiscoveryService({
    collectExternalHints: async () => {
      collected += 1
      return { hints: [
        { installPath: '/default', origin: 'default-location' },
        { hubHint: true, installPath: '/default', origin: 'qortal-hub' },
      ], kind: 'observed' }
    },
    discoverCandidates: async (hints) => {
      discovered += 1
      received = hints
      await Promise.resolve()
      return { candidates: [candidate('/default', ['default-location', 'qortal-hub']),
        candidate('/running', ['running-process']),
        ...hints.some((hint) => hint.origin === 'user-selected')
          ? [candidate('/picked', ['user-selected'])]
          : []], kind: 'observed' }
    },
    inspectProcesses: async () => observedProcesses,
  }, 'linux')
  const [first, second] = await Promise.all([service.discover(manager), service.discover(manager)])
  assert.equal(first, second, 'concurrent list discovery must be single-flighted')
  assert.equal(collected, 1)
  assert.equal(discovered, 1)
  assert.deepEqual(first.candidates.map((entry) => entry.canonicalInstallPath), ['/default', '/running'])
  assert.equal(received.filter((hint) => hint.installPath === '/default').length, 2,
    'the low-level discovery boundary receives duplicate origins for canonical merging')
  assert.equal(received.some((hint) => hint.origin === 'running-process' && hint.installPath === '/running' &&
    hint.runningProcessMatch === true), true)
  assert.equal(received.some((hint) => hint.installPath === '/wrong'), false,
    'an incompatible cwd/settings process must not be called a running match')

  const picked = await service.discover(manager, '/picked')
  assert.equal(picked.kind, 'complete')
  assert.equal(picked.candidates.some((entry) => entry.origins.includes('user-selected')), true)
  assert.equal(received.some((hint) => hint.origin === 'user-selected' && hint.installPath === '/picked'), true)
  assert.equal(collected, 2, 'chooser discovery is fresh and not folded into the list single-flight')
}

{
  const invalidPicked = new HomeV2QortalAdoptionDiscoveryService({
    collectExternalHints: async () => ({ hints: [], kind: 'observed' }),
    discoverCandidates: async () => ({ candidates: [], kind: 'observed' }),
    inspectProcesses: async () => ({ kind: 'observed', processes: [] }),
  }, 'linux')
  assert.deepEqual(await invalidPicked.discover(manager, '/invalid'), { candidates: [], kind: 'incomplete' },
    'Browse must fail closed unless the selected directory was inspected as a user-selected candidate')
}

for (const service of [
  new HomeV2QortalAdoptionDiscoveryService({
    collectExternalHints: async () => ({ hints: [], kind: 'unknown' }),
    discoverCandidates: async () => ({ candidates: [], kind: 'observed' }),
    inspectProcesses: async () => observedProcesses,
  }, 'linux'),
  new HomeV2QortalAdoptionDiscoveryService({
    collectExternalHints: async () => ({ hints: [], kind: 'observed' }),
    discoverCandidates: async () => ({ candidates: [], kind: 'observed' }),
    inspectProcesses: async () => ({ kind: 'unknown', processes: [], reason: '/private/process/reason' }),
  }, 'linux'),
  new HomeV2QortalAdoptionDiscoveryService({
    collectExternalHints: async () => ({
      hints: Array.from({ length: 33 }, (_, index) => ({
        installPath: `/candidate-${index}`,
        origin: 'default-location' as const,
      })),
      kind: 'observed',
    }),
    discoverCandidates: async () => { throw new Error('must not inspect an unbounded hint list') },
    inspectProcesses: async () => ({ kind: 'observed', processes: [] }),
  }, 'linux'),
]) {
  const result = await service.discover(manager)
  assert.deepEqual(result, { candidates: [], kind: 'incomplete' })
  assert.doesNotMatch(JSON.stringify(result), /private|reason|path|digest/i)
}

console.log('Home v2 Qortal adoption production-discovery checks passed.')
