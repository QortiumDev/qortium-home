import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  HomeV2CoreManagerClient,
  HomeV2QortalAdoptionBrowseResult,
  HomeV2QortalAdoptionList,
  HomeV2QortalAdoptionSelectionResult,
  HomeV2QortalMaintenanceActionResult,
  HomeV2QortalMaintenanceRelease,
  HomeV2QortalMaintenanceStatus,
} from '../../home-v2-live/core-manager-client'
import {
  parseHomeV2QortalAdoptionBrowseResult,
  parseHomeV2QortalAdoptionList,
  parseHomeV2QortalAdoptionSelectionResult,
  parseHomeV2QortalMaintenanceActionResult,
  parseHomeV2QortalMaintenanceRelease,
  parseHomeV2QortalMaintenanceStatus,
} from '../../home-v2-live/core-manager-client'
import { useHomeV2QortalMaintenance } from '../../home-v2-live/qortal-maintenance-controller'
import type { HomeV2CoreManagement } from './CoreManagerCards'
import { QortalMaintenancePanel } from './QortalMaintenancePanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const missingStatus: HomeV2QortalMaintenanceStatus = {
  capabilities: { canCheckRelease: true, canInitialInstall: true, canUpdate: false },
  discovery: 'clear',
  install: 'missing',
  installedVersion: null,
  lastRelease: null,
  lastReleaseCheckedAt: null,
  issue: null,
  network: 'qortal',
  revision: 1,
  runtime: 'stopped',
  schema: 'home-v2-qortal-maintenance',
  updateAuthority: 'observe-only',
}

const installRelease: HomeV2QortalMaintenanceRelease = {
  action: 'initial-install',
  available: true,
  code: null,
  network: 'qortal',
  revision: 1,
  schema: 'home-v2-qortal-maintenance-release',
  tag: 'v6.2.0',
}

const updateRelease: HomeV2QortalMaintenanceRelease = {
  ...installRelease,
  action: 'strict-update',
  tag: 'v6.3.0',
}

const installedStatus: HomeV2QortalMaintenanceStatus = {
  ...missingStatus,
  capabilities: { canCheckRelease: true, canInitialInstall: false, canUpdate: true },
  discovery: 'not-applicable',
  install: 'home-managed',
  installedVersion: '6.2.0',
  updateAuthority: 'home-github',
}

const adoptedStatus: HomeV2QortalMaintenanceStatus = {
  ...installedStatus,
  capabilities: { canCheckRelease: false, canInitialInstall: false, canUpdate: false },
  install: 'adopted',
}

const firstCandidateId = '11111111-1111-4111-8111-111111111111'
const secondCandidateId = '22222222-2222-4222-8222-222222222222'
const firstCandidate = {
  candidateId: firstCandidateId,
  hubHint: true,
  origins: ['qortal-hub'] as const,
  runningProcessMatch: false,
  version: '6.2.0',
}
const secondCandidate = {
  candidateId: secondCandidateId,
  hubHint: false,
  origins: ['running-process'] as const,
  runningProcessMatch: true,
  version: '6.1.9',
}
const adoptionList: HomeV2QortalAdoptionList = {
  canBrowse: true,
  canSelect: true,
  candidates: [firstCandidate],
  code: null,
  network: 'qortal',
  revision: 1,
  schema: 'home-v2-qortal-adoption-list',
  state: 'complete',
}
const adoptionSelection: HomeV2QortalAdoptionSelectionResult = {
  code: null,
  network: 'qortal',
  outcome: 'completed',
  revision: 1,
  schema: 'home-v2-qortal-adoption-selection',
  status: adoptedStatus,
}

function client(overrides: Partial<HomeV2CoreManagerClient> = {}): HomeV2CoreManagerClient {
  return {
    getMaintenanceStatus: async () => ({} as never),
    checkMaintenanceRelease: async () => ({} as never),
    runMaintenanceAction: async () => ({} as never),
    getUpdatePolicy: async () => ({} as never),
    setUpdatePolicy: async () => ({} as never),
    getStatus: async () => ({} as never),
    start: async () => ({} as never),
    stop: async () => ({} as never),
    listQortalAdoptionCandidates: async () => adoptionList,
    browseQortalAdoptionDirectory: async () => ({
      canceled: false,
      list: adoptionList,
      network: 'qortal',
      revision: 1,
      schema: 'home-v2-qortal-adoption-browse',
    }),
    selectQortalAdoptionCandidate: async () => adoptionSelection,
    getQortalMaintenanceStatus: async () => missingStatus,
    checkQortalMaintenanceRelease: async () => installRelease,
    runQortalMaintenanceAction: async () => ({
      code: null,
      network: 'qortal',
      outcome: 'completed',
      revision: 1,
      schema: 'home-v2-qortal-maintenance-action',
      status: installedStatus,
      warning: null,
    }),
    ...overrides,
  }
}

const management = {
  available: true,
  busyActions: { qortal: null, qortium: null },
  lastActions: { qortal: null, qortium: null },
  statuses: {} as never,
} satisfies HomeV2CoreManagement

// The panel takes its controller as a prop now, so the app can own exactly one
// per domain. This harness stands in for HomeV2LiveApp: it calls the real
// controller hook and hands the whole return to the panel, so the polling, the
// adoption flow and the busy gating below are still exercised end to end.
function QortalMaintenanceHarness({
  management: coreManagement,
}: {
  readonly management: HomeV2CoreManagement
}) {
  const maintenance = useHomeV2QortalMaintenance(coreManagement.onRefresh)
  return <QortalMaintenancePanel maintenance={maintenance} />
}

assert.deepEqual(parseHomeV2QortalMaintenanceStatus(missingStatus), missingStatus)
assert.throws(() => parseHomeV2QortalMaintenanceStatus({
  ...missingStatus,
  network: 'qortium',
}), /Invalid Home 2 Qortal maintenance status/)
assert.throws(() => parseHomeV2QortalMaintenanceStatus({
  ...missingStatus,
  privatePath: '/secret/qortal',
}), /Invalid Home 2 Qortal maintenance status/)
assert.throws(() => parseHomeV2QortalMaintenanceStatus({
  ...installedStatus,
  installedVersion: 'v'.repeat(129),
}), /Invalid Home 2 Qortal maintenance status/)
assert.throws(() => parseHomeV2QortalMaintenanceStatus({
  ...installedStatus,
  updateAuthority: 'node-native',
}), /Invalid Home 2 Qortal maintenance status/)
assert.deepEqual(parseHomeV2QortalMaintenanceRelease(installRelease), installRelease)
// Every field must survive by name. The parser used to spread-and-cast, which
// meant a field the contract added but the key list did not name was rejected
// outright rather than dropped (#454), with the cast hiding it from tsc.
{
  const parsed = parseHomeV2QortalMaintenanceRelease(installRelease)
  assert.equal(parsed.action, installRelease.action)
  assert.equal(parsed.available, installRelease.available)
  assert.equal(parsed.code, installRelease.code)
  assert.equal(parsed.tag, installRelease.tag)
  assert.equal(parsed.network, 'qortal')
  assert.equal(parsed.revision, 1)
}
assert.throws(() => parseHomeV2QortalMaintenanceRelease({
  ...installRelease,
  available: false,
}), /Invalid Home 2 Qortal maintenance release/)
assert.throws(() => parseHomeV2QortalMaintenanceActionResult({
  code: null,
  network: 'qortal',
  outcome: 'completed',
  privateReason: '/secret',
  revision: 1,
  schema: 'home-v2-qortal-maintenance-action',
  status: installedStatus,
  warning: null,
}), /Invalid Home 2 Qortal maintenance action result/)
assert.deepEqual(parseHomeV2QortalAdoptionList(adoptionList), adoptionList)
assert.throws(() => parseHomeV2QortalAdoptionList({
  ...adoptionList,
  privatePath: '/secret/qortal',
}), /Invalid Home 2 Qortal adoption list/)
assert.throws(() => parseHomeV2QortalAdoptionList({
  ...adoptionList,
  candidates: [{ ...firstCandidate, candidateId: '/secret/qortal' }],
}), /Invalid Home 2 Qortal adoption candidate/)
assert.throws(() => parseHomeV2QortalAdoptionList({
  ...adoptionList,
  canSelect: true,
  candidates: [],
}), /Invalid Home 2 Qortal adoption list/)
assert.throws(() => parseHomeV2QortalAdoptionList({
  ...adoptionList,
  canSelect: true,
  code: 'discovery-incomplete',
  state: 'incomplete',
}), /Invalid Home 2 Qortal adoption list/)
assert.deepEqual(parseHomeV2QortalAdoptionList({
  ...adoptionList,
  canBrowse: false,
  canSelect: false,
  code: 'unsupported-platform',
  state: 'unsupported',
}), {
  ...adoptionList,
  canBrowse: false,
  canSelect: false,
  code: 'unsupported-platform',
  state: 'unsupported',
})
const browseResult: HomeV2QortalAdoptionBrowseResult = {
  canceled: false,
  list: adoptionList,
  network: 'qortal',
  revision: 1,
  schema: 'home-v2-qortal-adoption-browse',
}
assert.deepEqual(parseHomeV2QortalAdoptionBrowseResult(browseResult), browseResult)
assert.throws(() => parseHomeV2QortalAdoptionBrowseResult({
  ...browseResult,
  selectedPath: '/secret/qortal',
}), /Invalid Home 2 Qortal adoption browse result/)
assert.deepEqual(parseHomeV2QortalAdoptionSelectionResult(adoptionSelection), adoptionSelection)
assert.throws(() => parseHomeV2QortalAdoptionSelectionResult({
  ...adoptionSelection,
  privateReason: '/secret/qortal',
}), /Invalid Home 2 Qortal adoption selection result/)
assert.throws(() => parseHomeV2QortalAdoptionSelectionResult({
  ...adoptionSelection,
  code: 'candidate-expired',
}), /Invalid Home 2 Qortal adoption selection result/)
assert.throws(() => parseHomeV2QortalAdoptionSelectionResult({
  ...adoptionSelection,
  code: 'persistence-unknown',
  outcome: 'blocked',
}), /Invalid Home 2 Qortal adoption selection result/)

const container = document.createElement('div')
document.body.appendChild(container)
let root = createRoot(container)
const originalSetInterval = window.setInterval
const originalClearInterval = window.clearInterval
let refreshInterval: (() => void) | null = null
window.setInterval = ((handler: TimerHandler) => {
  assert.equal(typeof handler, 'function')
  refreshInterval = handler as () => void
  return 1
}) as typeof window.setInterval
window.clearInterval = (() => undefined) as typeof window.clearInterval

function button(label: string) {
  const found = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === label)
  assert(found, `expected button ${label}`)
  return found as HTMLButtonElement
}

async function render(
  nextClient: HomeV2CoreManagerClient,
  nextManagement: HomeV2CoreManagement = management,
) {
  window.homeV2CoreManagers = nextClient
  await act(async () => {
    root.render(<QortalMaintenanceHarness management={nextManagement} />)
    await Promise.resolve()
    await Promise.resolve()
  })
}

try {
  let adoptionListCalls = 0
  let adoptionRefreshes = 0
  const selectedCandidates: string[] = []
  let resolveAdoptionList!: (value: HomeV2QortalAdoptionList) => void
  const pendingAdoptionList = new Promise<HomeV2QortalAdoptionList>((resolve) => {
    resolveAdoptionList = resolve
  })
  let resolveAdoptionSelection!: (value: HomeV2QortalAdoptionSelectionResult) => void
  const pendingAdoptionSelection = new Promise<HomeV2QortalAdoptionSelectionResult>((resolve) => {
    resolveAdoptionSelection = resolve
  })
  const adoptionManagement = {
    ...management,
    onRefresh: () => { adoptionRefreshes += 1 },
  }
  await render(client({
    listQortalAdoptionCandidates: async () => {
      adoptionListCalls += 1
      return await pendingAdoptionList
    },
    selectQortalAdoptionCandidate: async (candidateId) => {
      selectedCandidates.push(candidateId)
      return await pendingAdoptionSelection
    },
  }), adoptionManagement)
  assert.equal(adoptionListCalls, 0, 'candidate inspection must be explicitly requested')
  await act(async () => {
    const interval = refreshInterval
    assert(interval)
    interval()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal(adoptionListCalls, 0, 'maintenance polling must not scan adoption candidates')
  await act(async () => {
    button('Review existing installations').click()
    await Promise.resolve()
  })
  assert.equal(adoptionListCalls, 1)
  assert.equal(container.querySelector('[data-home-v2-qortal-adoption]')
    ?.getAttribute('aria-busy'), 'true')
  assert.match(container.textContent ?? '', /Discovering existing Qortal installations/)
  await act(async () => {
    resolveAdoptionList(adoptionList)
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal(container.querySelector('[data-home-v2-qortal-adoption]')
    ?.getAttribute('aria-busy'), 'false')
  assert.match(container.textContent ?? '', /Qortal Hub/)
  assert.match(container.textContent ?? '', /Version 6\.2\.0/)
  const onlyCandidate = container.querySelector<HTMLInputElement>(
    'input[name="qortal-adoption-candidate"]',
  )
  assert.equal(onlyCandidate?.checked, true)
  await act(async () => {
    button('Use this installation').click()
    await Promise.resolve()
  })
  assert.deepEqual(selectedCandidates, [firstCandidateId])
  assert.equal(container.querySelector('[data-home-v2-qortal-adoption]')
    ?.getAttribute('aria-busy'), 'true')
  assert.ok(button('Using this installation').disabled)
  await act(async () => {
    resolveAdoptionSelection(adoptionSelection)
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal(adoptionRefreshes, 1)
  assert.match(container.textContent ?? '', /Home did not modify adopted files/)
  assert.equal(container.querySelector('[data-home-v2-qortal-adoption]'), null)

  const multipleList: HomeV2QortalAdoptionList = {
    ...adoptionList,
    candidates: [firstCandidate, secondCandidate],
  }
  await render(client({ listQortalAdoptionCandidates: async () => multipleList }))
  await act(async () => {
    button('Review existing installations').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  const multipleRadios = [...container.querySelectorAll<HTMLInputElement>(
    'input[name="qortal-adoption-candidate"]',
  )]
  assert.equal(multipleRadios.length, 2)
  assert.equal(multipleRadios.some((radio) => radio.checked), false)
  assert.equal(button('Use this installation').disabled, true)
  assert.match(container.textContent ?? '', /Running Qortal process/)
  assert.match(container.textContent ?? '', /Currently running/)
  act(() => multipleRadios[1]?.click())
  assert.equal(button('Use this installation').disabled, false)

  const unknownVersionList: HomeV2QortalAdoptionList = {
    ...adoptionList,
    candidates: [{ ...firstCandidate, version: null }],
  }
  await render(client({ listQortalAdoptionCandidates: async () => unknownVersionList }))
  await act(async () => {
    button('Review existing installations').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.match(container.textContent ?? '', /Version unavailable/)
  assert.equal(container.querySelector<HTMLInputElement>(
    'input[name="qortal-adoption-candidate"]',
  )?.disabled, true)
  assert.equal(button('Use this installation').disabled, true)

  const browsedList: HomeV2QortalAdoptionList = {
    ...adoptionList,
    candidates: [{
      ...firstCandidate,
      hubHint: false,
      origins: ['user-selected'],
    }],
  }
  await render(client({
    listQortalAdoptionCandidates: async () => ({
      ...adoptionList,
      canSelect: false,
      candidates: [],
    }),
    browseQortalAdoptionDirectory: async () => ({
      ...browseResult,
      list: browsedList,
    }),
  }))
  await act(async () => {
    button('Review existing installations').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    button('Browse for Qortal installation').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.match(container.textContent ?? '', /Selected in the system folder picker/)
  assert.equal(container.querySelector<HTMLInputElement>(
    'input[name="qortal-adoption-candidate"]',
  )?.checked, true)
  assert.doesNotMatch(
    container.querySelector('[data-home-v2-qortal-adoption]')?.textContent ?? '',
    /\/secret|settings\.json/i,
  )

  let resolveCanceledBrowse!: (value: HomeV2QortalAdoptionBrowseResult) => void
  const pendingCanceledBrowse = new Promise<HomeV2QortalAdoptionBrowseResult>((resolve) => {
    resolveCanceledBrowse = resolve
  })
  await render(client({ browseQortalAdoptionDirectory: async () => pendingCanceledBrowse }))
  await act(async () => {
    button('Review existing installations').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal(button('Use this installation').disabled, false)
  await act(async () => {
    button('Browse for Qortal installation').click()
    await Promise.resolve()
  })
  assert.equal(container.querySelector('[data-home-v2-qortal-adoption]')
    ?.getAttribute('aria-busy'), 'true')
  await act(async () => {
    resolveCanceledBrowse({
      ...browseResult,
      canceled: true,
      list: { ...adoptionList, candidates: [secondCandidate] },
    })
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal(container.querySelector('[data-home-v2-qortal-adoption]')
    ?.getAttribute('aria-busy'), 'false')
  assert.equal(container.querySelector<HTMLInputElement>(
    'input[name="qortal-adoption-candidate"]',
  )?.checked, false, 'canceling Browse must clear tokens from the prior snapshot')
  assert.equal(button('Use this installation').disabled, true)
  assert.match(container.textContent ?? '', /No folder was selected/)

  await render(client({
    browseQortalAdoptionDirectory: async () => { throw new Error('picker unavailable') },
  }))
  await act(async () => {
    button('Review existing installations').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal(button('Use this installation').disabled, false)
  await act(async () => {
    button('Browse for Qortal installation').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal(container.querySelector<HTMLInputElement>(
    'input[name="qortal-adoption-candidate"]',
  ), null, 'a failed Browse must discard candidates with invalidated tokens')
  assert.equal([...container.querySelectorAll('button')]
    .some((item) => item.textContent?.trim() === 'Use this installation'), false)
  assert.ok(button('Review existing installations'), 'a failed Browse must require fresh review')
  assert.match(container.textContent ?? '', /could not open or validate the selected folder/)

  for (const selectFailure of [
    async (): Promise<HomeV2QortalAdoptionSelectionResult> => ({
      code: 'persistence-unknown',
      network: 'qortal',
      outcome: 'failed',
      revision: 1,
      schema: 'home-v2-qortal-adoption-selection',
      status: missingStatus,
    }),
    async (): Promise<HomeV2QortalAdoptionSelectionResult> => {
      throw new Error('select IPC unavailable')
    },
  ]) {
    await render(client({ selectQortalAdoptionCandidate: selectFailure }))
    await act(async () => {
      button('Review existing installations').click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      button('Use this installation').click()
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.equal(container.querySelector<HTMLInputElement>(
      'input[name="qortal-adoption-candidate"]',
    ), null, 'a failed selection must discard candidates with consumed tokens')
    assert.ok(button('Review existing installations'), 'a failed selection must require fresh review')
    assert.match(container.textContent ?? '', /could not save this installation selection/)
  }

  await render(client({
    selectQortalAdoptionCandidate: async () => ({
      code: 'operation-in-progress',
      network: 'qortal',
      outcome: 'blocked',
      revision: 1,
      schema: 'home-v2-qortal-adoption-selection',
      status: missingStatus,
    }),
  }))
  await act(async () => {
    button('Review existing installations').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    button('Use this installation').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal(container.querySelector<HTMLInputElement>(
    'input[name="qortal-adoption-candidate"]',
  )?.checked, true, 'operation-in-progress must preserve its unconsumed token')
  assert.equal(button('Use this installation').disabled, false)

  const incompleteList: HomeV2QortalAdoptionList = {
    canBrowse: false,
    canSelect: false,
    candidates: [],
    code: 'discovery-incomplete',
    network: 'qortal',
    revision: 1,
    schema: 'home-v2-qortal-adoption-list',
    state: 'incomplete',
  }
  await render(client({ listQortalAdoptionCandidates: async () => incompleteList }))
  await act(async () => {
    button('Review existing installations').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /Candidate details are incomplete/)
  assert.equal(button('Browse for Qortal installation').disabled, true)
  assert.equal([...container.querySelectorAll('button')]
    .some((item) => item.textContent?.trim() === 'Use this installation'), false)

  const unsupportedList: HomeV2QortalAdoptionList = {
    canBrowse: false,
    canSelect: false,
    candidates: [firstCandidate],
    code: 'unsupported-platform',
    network: 'qortal',
    revision: 1,
    schema: 'home-v2-qortal-adoption-list',
    state: 'unsupported',
  }
  await render(client({ listQortalAdoptionCandidates: async () => unsupportedList }))
  await act(async () => {
    button('Review existing installations').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /unavailable on this platform/)
  assert.equal(button('Browse for Qortal installation').disabled, true)
  assert.equal(button('Use this installation').disabled, true)
  assert.equal(container.querySelector<HTMLInputElement>(
    'input[name="qortal-adoption-candidate"]',
  )?.disabled, true)
  assert.match(container.textContent ?? '', /Qortal Hub/)
  assert.match(container.textContent ?? '', /Version 6\.2\.0/)

  let staleListCalls = 0
  await render(client({
    listQortalAdoptionCandidates: async () => {
      staleListCalls += 1
      return adoptionList
    },
    selectQortalAdoptionCandidate: async () => ({
      code: 'candidate-expired',
      network: 'qortal',
      outcome: 'blocked',
      revision: 1,
      schema: 'home-v2-qortal-adoption-selection',
      status: missingStatus,
    }),
  }))
  await act(async () => {
    button('Review existing installations').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    button('Use this installation').click()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal(staleListCalls, 2, 'expired selection should refresh candidates once')
  assert.match(container.textContent ?? '', /candidate list changed or could not be refreshed/i)
  assert.equal([...container.querySelectorAll<HTMLInputElement>(
    'input[name="qortal-adoption-candidate"]',
  )].some((radio) => radio.checked), false, 'refreshed stale state must require review')
  assert.equal(button('Use this installation').disabled, true)

  let resolveLateBrowse!: (value: HomeV2QortalAdoptionBrowseResult) => void
  const lateBrowse = new Promise<HomeV2QortalAdoptionBrowseResult>((resolve) => {
    resolveLateBrowse = resolve
  })
  await render(client({ browseQortalAdoptionDirectory: async () => lateBrowse }))
  await act(async () => {
    button('Review existing installations').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    button('Browse for Qortal installation').click()
    await Promise.resolve()
  })
  await render(client({ getQortalMaintenanceStatus: async () => installedStatus }))
  await act(async () => {
    resolveLateBrowse({ ...browseResult, list: browsedList })
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.doesNotMatch(container.textContent ?? '', /Selected in the system folder picker/)
  assert.match(container.textContent ?? '', /Home can install a strictly newer verified stable release/)

  const actions: Array<{ action: string; expectedTag: string }> = []
  await render(client({
    runQortalMaintenanceAction: async (action, expectedTag) => {
      actions.push({ action, expectedTag })
      return {
        code: null,
        network: 'qortal',
        outcome: 'completed',
        revision: 1,
        schema: 'home-v2-qortal-maintenance-action',
        status: installedStatus,
        warning: null,
      }
    },
  }))
  assert.match(container.textContent ?? '', /verified stable release/)
  assert.equal(container.querySelector('[data-network="qortal"]') !== null, true)
  assert.equal([...container.querySelectorAll('button')].some((item) => /Start|Stop/.test(item.textContent ?? '')), false)

  await act(async () => {
    button('Check stable release').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.match(container.textContent ?? '', /v6\.2\.0 is ready to install/)
  const installButton = button('Install Qortal Core')
  assert.equal(installButton.getAttribute('aria-describedby'), 'qortal-maintenance-state')
  assert.match(document.getElementById('qortal-maintenance-state')?.textContent ?? '', /not installed/)
  await act(async () => {
    installButton.click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.deepEqual(actions, [{ action: 'initial-install', expectedTag: 'v6.2.0' }])
  assert.match(container.textContent ?? '', /maintenance completed/)

  const nativeStatus: HomeV2QortalMaintenanceStatus = {
    ...installedStatus,
    capabilities: { canCheckRelease: false, canInitialInstall: false, canUpdate: false },
    updateAuthority: 'node-native',
  }
  await render(client({ getQortalMaintenanceStatus: async () => nativeStatus }))
  assert.match(container.textContent ?? '', /own automatic updater manages updates/)
  assert.equal([...container.querySelectorAll('button')]
    .some((item) => item.textContent?.includes('Check stable release')), false)

  const adoptedStatus: HomeV2QortalMaintenanceStatus = {
    ...installedStatus,
    capabilities: { canCheckRelease: false, canInitialInstall: false, canUpdate: false },
    install: 'adopted',
  }
  await render(client({ getQortalMaintenanceStatus: async () => adoptedStatus }))
  assert.match(container.textContent ?? '', /does not modify adopted files/)

  let refreshedStatus = installedStatus
  await render(client({
    getQortalMaintenanceStatus: async () => refreshedStatus,
    checkQortalMaintenanceRelease: async () => updateRelease,
  }))
  await act(async () => {
    button('Check stable release').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.ok(button('Update Qortal Core'))
  refreshedStatus = {
    ...installedStatus,
    capabilities: { canCheckRelease: false, canInitialInstall: false, canUpdate: false },
  }
  await act(async () => {
    const interval = refreshInterval
    assert(interval)
    interval()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal([...container.querySelectorAll('button')]
    .some((item) => item.textContent?.includes('Update Qortal Core')), false)

  let refreshShouldFail = false
  await render(client({
    getQortalMaintenanceStatus: async () => {
      if (refreshShouldFail) throw new Error('refresh unavailable')
      return installedStatus
    },
    checkQortalMaintenanceRelease: async () => updateRelease,
  }))
  await act(async () => {
    button('Check stable release').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.ok(button('Update Qortal Core'))
  refreshShouldFail = true
  await act(async () => {
    const interval = refreshInterval
    assert(interval)
    interval()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.match(container.textContent ?? '', /shown state may be stale/)
  assert.equal([...container.querySelectorAll('button')]
    .some((item) => item.textContent?.includes('Update Qortal Core')), false)

  let resolveOldAction!: (value: HomeV2QortalMaintenanceActionResult) => void
  const oldAction = new Promise<HomeV2QortalMaintenanceActionResult>((resolve) => {
    resolveOldAction = resolve
  })
  await render(client({
    getQortalMaintenanceStatus: async () => installedStatus,
    checkQortalMaintenanceRelease: async () => updateRelease,
    runQortalMaintenanceAction: async () => oldAction,
  }))
  await act(async () => {
    button('Check stable release').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    button('Update Qortal Core').click()
    await Promise.resolve()
  })
  await render(client({ getQortalMaintenanceStatus: async () => nativeStatus }))
  await act(async () => {
    resolveOldAction({
      code: null,
      network: 'qortal',
      outcome: 'completed',
      revision: 1,
      schema: 'home-v2-qortal-maintenance-action',
      status: installedStatus,
      warning: null,
    })
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.doesNotMatch(container.textContent ?? '', /maintenance completed/)
  assert.match(container.textContent ?? '', /own automatic updater manages updates/)

  let resolveOldCheck!: (value: HomeV2QortalMaintenanceRelease) => void
  const oldCheck = new Promise<HomeV2QortalMaintenanceRelease>((resolve) => {
    resolveOldCheck = resolve
  })
  await render(client({ checkQortalMaintenanceRelease: async () => oldCheck }))
  await act(async () => {
    button('Check stable release').click()
    await Promise.resolve()
  })
  await render(client({ getQortalMaintenanceStatus: async () => nativeStatus }))
  await act(async () => {
    resolveOldCheck({ ...installRelease, tag: 'v9.9.9' })
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.doesNotMatch(container.textContent ?? '', /v9\.9\.9/)
  assert.match(container.textContent ?? '', /own automatic updater manages updates/)

  act(() => root.unmount())
  root = createRoot(container)
  await render(client({ getQortalMaintenanceStatus: async () => { throw new Error('unavailable') } }))
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /status is unavailable/)
  assert.ok(button('Retry Qortal maintenance status'))

  act(() => root.unmount())
  root = createRoot(container)
  delete window.homeV2CoreManagers
  await act(async () => {
    root.render(<QortalMaintenanceHarness management={management} />)
    await Promise.resolve()
  })
  assert.equal(container.textContent, '')
} finally {
  act(() => root.unmount())
  window.setInterval = originalSetInterval
  window.clearInterval = originalClearInterval
  delete window.homeV2CoreManagers
  container.remove()
}

// A release the app already knows about (six-hourly update pass, or an earlier
// manual check) must offer Install straight away — pressing "Check release"
// first was the reported annoyance, and status reads never call GitHub.
{
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let checkCalls = 0
  const cachedStatus: HomeV2QortalMaintenanceStatus = {
    ...missingStatus,
    lastRelease: installRelease,
    lastReleaseCheckedAt: '2026-08-24T12:00:00.000Z',
  }
  try {
    window.homeV2CoreManagers = client({
      getQortalMaintenanceStatus: async () => cachedStatus,
      checkQortalMaintenanceRelease: async () => {
        checkCalls += 1
        return installRelease
      },
    })
    await act(async () => {
      root.render(<QortalMaintenanceHarness management={management} />)
      await Promise.resolve()
    })
    await act(async () => { await Promise.resolve() })
    const buttons = [...container.querySelectorAll('button')].map((button) => button.textContent)
    assert.ok(
      buttons.some((label) => label && /install/i.test(label)),
      `Install must be offered from the cached release; saw ${JSON.stringify(buttons)}`,
    )
    assert.equal(checkCalls, 0, 'showing a cached release must not call GitHub')
  } finally {
    act(() => root.unmount())
    delete window.homeV2CoreManagers
    container.remove()
  }
}

console.log('Home v2 Qortal maintenance panel tests passed.')
