// Internal pages stay MOUNTED per tab, and the Runtime settings render one
// Core maintenance panel per network. Every static `id=` in those components
// therefore appears twice in one document, which breaks `aria-labelledby`,
// `aria-describedby` and `htmlFor`: the browser resolves each to the FIRST
// match, so the second Settings tab's select was described by the first tab's
// text and a screen reader read the wrong panel.
//
// These renders reproduce that exactly — two of each internal page in one React
// root — and assert that no id repeats and that every reference resolves.
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import type { HomeV2AppUpdates } from '../../home-v2-live/app-update-controller'
import type { HomeV2CoreMaintenance } from '../../home-v2-live/core-maintenance-controller'
import type { HomeV2OnChainCoreUpdates } from '../../home-v2-live/on-chain-core-update-controller'
import type { HomeV2QdnSettingsManagement } from '../../home-v2-live/qdn-settings-client'
import type { HomeV2QortalMaintenance } from '../../home-v2-live/qortal-maintenance-controller'
import type { HomeV2TransportMaintenance } from '../../home-v2-live/transport-maintenance-controller'
import { createPermissionState } from '../bridge-permissions'
import {
  createProductState,
  reduceProductState,
  type ProductState,
} from '../product-model'
import { homeV2Fixture } from '../test-kit/fixtures'
import type { TabId } from '../contracts'
import type { HomeV2CoreManagement } from './CoreManagerCards'
import { HomeV2Prototype } from './HomeV2Prototype'
import { SettingsPage } from './SettingsPage'

const coreManagement: HomeV2CoreManagement = {
  available: true,
  busyActions: { qortal: null, qortium: null },
  lastActions: { qortal: null, qortium: null },
  statuses: {
    qortium: {
      capabilities: { canStart: false, canStop: true },
      control: 'full',
      install: 'home-managed',
      issue: null,
      network: 'qortium',
      revision: 1,
      runtime: 'running',
      schema: 'home-v2-core-manager',
    },
    qortal: {
      capabilities: { canStart: true, canStop: false },
      control: 'api-only',
      install: 'adopted',
      issue: null,
      network: 'qortal',
      revision: 1,
      runtime: 'stopped',
      schema: 'home-v2-core-manager',
    },
  },
  onAction: () => undefined,
  onRefresh: () => undefined,
}

// A managed Java runtime and an installed Qortium Core: the combination that
// renders every policy row the panel owns, which is where the ids collided.
const coreMaintenance = {
  available: true,
  busy: null,
  canRevealInstall: true,
  check: async () => undefined,
  confirmDowngrade: async () => undefined,
  initialLoadFailed: false,
  installJava: async () => undefined,
  installOnChainUpdate: async () => undefined,
  notice: null,
  pendingDowngrade: null,
  policy: {
    activity: {
      checkedAt: null,
      core: { channel: null, state: 'idle', version: null },
      generation: 0,
      issue: null,
      java: { state: 'idle', version: null },
      qortal: { state: 'idle', version: null },
    },
    coreUpdatePolicy: 'notify',
    generation: 0,
    javaUpdatePolicy: 'notify',
    qortalUpdatePolicy: 'notify',
    revision: 1,
    schema: 'home-v2-core-update-policy',
    settingsIssue: null,
  },
  progress: null,
  refresh: async () => undefined,
  refreshHelpers: async () => undefined,
  release: null,
  revealInstall: async () => true,
  runCore: async () => undefined,
  selectedReleaseTag: null,
  setSelectedReleaseTag: () => undefined,
  setUpdatePolicy: async () => undefined,
  status: {
    capabilities: {
      canInitialInstall: false,
      canInstallJava: true,
      canInstallOnChainUpdate: false,
      canRefreshHelpers: false,
      canUpdateRunningInPlace: false,
    },
    core: {
      channel: 'stable',
      helpersOutOfSyncVersion: null,
      installedCommit: null,
      installedTag: null,
      installModified: false,
      installedVersion: '1.7.2',
      localApiUrl: null,
      nodeAutoUpdateMode: null,
      runtime: 'stopped',
      runtimeBlockedReason: null,
      update: null,
      updateSources: null,
    },
    java: { source: 'managed', targetMajorVersion: 25, updateAvailable: false, version: '25.0.1' },
    revision: 1,
    schema: 'home-v2-core-maintenance',
  },
  // The panel reads a subset of the controller; the rest is not needed to
  // render, and spelling out the whole hook return here would only couple this
  // test to the controller's internals.
} as unknown as HomeV2CoreMaintenance

const appUpdates = {
  available: true,
  busy: null,
  canRevealInstallFolder: false,
  channel: 'stable',
  check: async () => undefined,
  download: null,
  downloadUpdate: async () => undefined,
  formattedSize: null,
  homeUpdatePolicy: 'notify',
  isAndroid: false,
  message: null,
  openDownloaded: async () => undefined,
  openReleasePage: async () => undefined,
  preferencesLoaded: true,
  progress: null,
  result: {
    asset: null,
    channel: 'stable',
    checkedAt: '2026-09-07T12:00:00.000Z',
    currentVersion: '2.1.0',
    issue: null,
    platform: { arch: 'x64', label: 'Linux x64', os: 'linux', supported: true },
    release: null,
    revision: 1,
    schema: 'home-v2-app-update-check',
    state: 'up-to-date',
  },
  revealDownloaded: async () => undefined,
  revealInstallFolder: async () => undefined,
  setChannel: () => undefined,
  setHomeUpdatePolicy: () => undefined,
} as unknown as HomeV2AppUpdates

const transportMaintenance = {
  available: true,
  busy: null,
  confirmRestart: async () => undefined,
  currentMode: 'direct-only',
  initialLoadFailed: false,
  modeAllowed: true,
  modeChanged: false,
  notice: null,
  progress: null,
  refresh: async () => undefined,
  restartRequired: false,
  run: async () => undefined,
  selectedMode: 'direct-only',
  setSelectedMode: () => undefined,
  stale: false,
  status: {
    capabilities: {
      canEnsureRouter: true,
      canRevealRouterFolder: false,
      canSetDirectAndI2p: true,
      canSetDirectOnly: true,
      canSetI2pOnly: false,
      canSetModeWhileRunning: false,
      canStopRouter: false,
      canUpdateRouter: false,
    },
    core: { install: 'installed', runtime: 'stopped' },
    issue: null,
    network: 'qortium',
    revision: 2,
    router: { maintenance: 'install', sam: 'unavailable', state: 'missing', version: null },
    schema: 'home-v2-transport-maintenance',
    transportMode: 'direct-only',
  },
} as unknown as HomeV2TransportMaintenance

// Adoption ENABLED, with candidates to choose between: the adoption branch owns
// its own ids and its own radio group, and it renders only for a missing
// install that Home has candidates for. The fixture used to disable it, so none
// of that markup was ever inspected.
const qortalMaintenance = {
  actionAllowed: true,
  adoptCandidate: async () => undefined,
  adoptionAvailable: true,
  adoptionBusy: false,
  adoptionList: {
    canBrowse: true,
    canSelect: true,
    candidates: [
      {
        candidateId: '11111111-1111-4111-8111-111111111111',
        hubHint: true,
        origins: ['qortal-hub'],
        runningProcessMatch: false,
        version: '6.2.0',
      },
      {
        candidateId: '22222222-2222-4222-8222-222222222222',
        hubHint: false,
        origins: ['running-process'],
        runningProcessMatch: true,
        version: '6.1.9',
      },
    ],
    code: null,
    network: 'qortal',
    revision: 1,
    schema: 'home-v2-qortal-adoption-list',
    state: 'complete',
  },
  adoptionSelectionAllowed: false,
  available: true,
  browseAdoption: async () => undefined,
  busy: null,
  check: async () => undefined,
  initialLoadFailed: false,
  notice: null,
  refresh: async () => undefined,
  release: null,
  reviewAdoptionCandidates: async () => undefined,
  run: async () => undefined,
  selectedCandidateId: null,
  setSelectedCandidateId: () => undefined,
  status: {
    capabilities: { canCheckRelease: true, canInitialInstall: true, canUpdate: false },
    discovery: 'multiple-candidates',
    install: 'missing',
    installedVersion: null,
    issue: null,
    lastRelease: null,
    lastReleaseCheckedAt: null,
    network: 'qortal',
    revision: 1,
    runtime: 'stopped',
    schema: 'home-v2-qortal-maintenance',
    updateAuthority: 'home-github',
  },
} as unknown as HomeV2QortalMaintenance

// The QDN Apps section owns per-role ids (`home-v2-qdn-assignment-error-*`) and
// three sub-section headings, and the Settings loop below skipped it entirely.
// Nothing is loaded here: the panel's snapshot arrives from an effect, which
// static rendering never runs, so the stub only has to exist.
const qdnAppsManagement = {
  available: true,
  client: {
    get: async () => { throw new Error('not loaded in a static render') },
    revoke: async () => { throw new Error('not loaded in a static render') },
    revokeBookmarks: async () => { throw new Error('not loaded in a static render') },
    setAssignment: async () => { throw new Error('not loaded in a static render') },
    setMuted: async () => { throw new Error('not loaded in a static render') },
    subscribe: () => () => undefined,
  },
} as unknown as HomeV2QdnSettingsManagement

const onChainCoreUpdates = {
  authenticated: true,
  available: true,
  busy: null,
  canInstall: false,
  check: async () => undefined,
  install: async () => undefined,
  message: null,
  status: null,
  tone: 'idle',
} as unknown as HomeV2OnChainCoreUpdates

/** Two tabs of every internal page, the way the shell actually mounts them. */
function twoOfEachPage(): ProductState {
  let state = createProductState()
  let counter = 0
  const open = (page: 'dashboard' | 'newtab' | 'settings') => {
    counter += 1
    state = reduceProductState(state, {
      type: 'open-internal',
      page,
      tabId: `duplicate-id-test-${page}-${counter}` as unknown as TabId,
    })
  }
  // createProductState() already opened one dashboard.
  open('dashboard')
  open('newtab')
  open('newtab')
  open('settings')
  open('settings')
  return state
}

/** Every id in the markup, and every id an ARIA/label reference points at. */
function inspect(html: string) {
  const ids = [...html.matchAll(/\sid="([^"]*)"/g)].map(([, value]) => value)
  const duplicates = [...new Set(ids.filter(
    (id, index) => ids.indexOf(id) !== index,
  ))]
  const dangling: string[] = []
  for (const [, attribute, value] of
    html.matchAll(/\s(aria-labelledby|aria-describedby|for)="([^"]*)"/g)) {
    for (const reference of value.split(/\s+/)) {
      if (reference && !ids.includes(reference)) dangling.push(`${attribute}=${reference}`)
    }
  }
  return { dangling, duplicates, ids }
}

function assertUnique(label: string, html: string) {
  const { dangling, duplicates } = inspect(html)
  assert.deepEqual(duplicates, [], `${label}: these ids appear more than once`)
  assert.deepEqual(dangling, [], `${label}: these references point at no element`)
  return html
}

// Two dashboards, two new-tab pages and two Settings pages, all mounted at once.
assertUnique('two of every internal page', renderToStaticMarkup(
  <HomeV2Prototype
    snapshot={homeV2Fixture}
    productState={twoOfEachPage()}
    permissionState={createPermissionState()}
    layout="desktop"
    appUpdates={appUpdates}
    coreManagement={coreManagement}
    maintenance={{ core: coreMaintenance }}
  />,
))

// Settings shows one section at a time, so each section needs its own pass.
for (const section of
  ['general', 'core', 'appearance', 'qdn-apps', 'account'] as const) {
  const settings = (
    <SettingsPage
      account={homeV2Fixture.account}
      appearance={homeV2Fixture.appearance}
      nodes={homeV2Fixture.nodes}
      newTabPreference={{ kind: 'dashboard' }}
      requestedSection={section}
      appUpdates={appUpdates}
      coreManagement={coreManagement}
      maintenance={{
        core: coreMaintenance,
        qortal: qortalMaintenance,
        transport: transportMaintenance,
      }}
      onChainCoreUpdates={onChainCoreUpdates}
      qdnAppsManagement={qdnAppsManagement}
    />
  )
  const html = assertUnique(
    `two Settings pages on "${section}"`,
    renderToStaticMarkup(<>{settings}{settings}</>),
  )

  if (section === 'qdn-apps') {
    // The section has to actually be REACHABLE, or this pass proves nothing:
    // SettingsPage falls back to General when a section is unavailable.
    assert.match(html, /qdnApps|QDN/i)
    assert.equal([...html.matchAll(/data-home-v2-qdn-settings/g)].length, 2)
  }

  if (section === 'core') {
    // The managed-Java policy belongs to the machine, not to a network. It used
    // to render inside BOTH per-network maintenance panels, so one Settings page
    // offered the same setting twice under two headings. Two pages are rendered
    // here, so each policy must appear exactly twice.
    const count = (attribute: string) =>
      [...html.matchAll(new RegExp(`\\s${attribute}(?=[\\s>=])`, 'g'))].length
    assert.equal(count('data-home-v2-java-update-policy'), 2,
      'exactly one managed-Java policy per Settings page')
    assert.equal(count('data-home-v2-core-update-policy'), 2,
      'exactly one Qortium Core policy per Settings page')
    assert.equal(count('data-home-v2-qortal-update-policy'), 2,
      'exactly one Qortal Core policy per Settings page')
    // The adoption branch renders here, and its radio group is scoped per
    // panel: two mounted panels are two groups, never one.
    assert.equal(count('data-home-v2-qortal-adoption'), 2, 'the adoption branch must render')
    const radioNames = new Set([...html.matchAll(/<input[^>]*name="([^"]*)"[^>]*>/g)]
      .filter(([tag]) => tag.includes('type="radio"'))
      .map(([, name]) => name))
    assert.equal(radioNames.size, 2, 'each adoption panel owns its own radio group')
  }
}

console.log('Home 2 duplicate DOM id tests passed.')
