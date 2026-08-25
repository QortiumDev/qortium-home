import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createProductState } from '../product-model'
import { homeV2Fixture } from '../test-kit/fixtures'
import { BrowserChrome, type AddressOpenResult } from './BrowserChrome'
import type { HomeV2CoreManagement } from './CoreManagerCards'
import type {
  DualIdentityLookupResult,
  HomeV2Snapshot,
  NetworkId,
} from '../contracts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const container = document.createElement('div')
document.body.appendChild(container)
const root = createRoot(container)
const destinations: string[] = []
const addresses: string[] = []
const nodeMenuCalls: string[] = []

/**
 * A Core manager with both networks in different shapes: Qortium is a
 * Home-managed Core that is stopped (so it may be started), Qortal is an
 * adopted Core Home only reaches over the API (so stopping it must confirm).
 */
const coreManagementFixture: HomeV2CoreManagement = {
  available: true,
  busyActions: { qortal: null, qortium: null },
  lastActions: { qortal: null, qortium: null },
  statuses: {
    qortium: {
      capabilities: { canStart: true, canStop: false },
      control: 'full',
      install: 'home-managed',
      issue: null,
      network: 'qortium',
      revision: 1,
      runtime: 'stopped',
      schema: 'home-v2-core-manager',
    },
    qortal: {
      capabilities: { canStart: false, canStop: true },
      control: 'api-only',
      install: 'adopted',
      issue: null,
      network: 'qortal',
      revision: 1,
      runtime: 'running',
      schema: 'home-v2-core-manager',
    },
  },
  onAction: (network, action) => nodeMenuCalls.push(`${network}:${action}`),
  coreMaintenance: {
    busy: null,
    notice: null,
    policy: null,
    release: null,
    status: {
      capabilities: { canInitialInstall: false, canInstallJava: false },
      core: { channel: 'stable', installedVersion: '1.7.2', runtime: 'stopped' },
      java: { source: 'managed', updateAvailable: false, version: '21' },
      revision: 1,
      schema: 'home-v2-core-maintenance',
    },
    onCheckRelease: () => nodeMenuCalls.push('qortium:check'),
    onRunRelease: () => nodeMenuCalls.push('qortium:install'),
  },
  qortalMaintenance: {
    actionAllowed: true,
    busy: null,
    notice: null,
    release: null,
    status: {
      capabilities: {
        canCheckRelease: true,
        canInitialInstall: false,
        canUpdate: true,
      },
      discovery: 'not-applicable',
      install: 'home-managed',
      installedVersion: '6.2.0',
      issue: null,
      lastRelease: null,
      lastReleaseCheckedAt: null,
      network: 'qortal',
      revision: 1,
      runtime: 'running',
      schema: 'home-v2-qortal-maintenance',
      updateAuthority: 'home-github',
    },
    onCheckRelease: () => nodeMenuCalls.push('qortal:check'),
    onRunRelease: () => nodeMenuCalls.push('qortal:install'),
  },
}

function newTabButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label="New tab"]',
  )
  assert.ok(button, 'the browser chrome should render a new-tab button')
  return button
}

function renderChrome(
  newTabPreference:
    | { readonly kind: 'search' }
    | { readonly kind: 'dashboard' }
    | { readonly address: string; readonly kind: 'custom' },
  options: {
    readonly coreManagement?: HomeV2CoreManagement
    readonly navigationDisabled?: boolean
    readonly openResult?: AddressOpenResult
    readonly selectedAccountLookup?: DualIdentityLookupResult
    readonly snapshot?: HomeV2Snapshot
  } = {},
): void {
  root.render(
    <BrowserChrome
      snapshot={options.snapshot ?? homeV2Fixture}
      productState={createProductState()}
      navigationDisabled={options.navigationDisabled}
      newTabPreference={newTabPreference}
      onNavigate={(destination) => destinations.push(destination)}
      onOpenAddress={async (address) => {
        addresses.push(address)
        return options.openResult ?? { status: 'opened' }
      }}
      selectedAccountLookup={options.selectedAccountLookup}
      loadVisibleAvatar={async () => ({ status: 'missing' })}
      coreManagement={options.coreManagement}
      onConfigureCustomNode={(network) =>
        nodeMenuCalls.push(`${network}:configure`)
      }
      onOpenCoreSettings={() => nodeMenuCalls.push('core-settings')}
      onSetNodeMode={(network, mode) => nodeMenuCalls.push(`${network}:${mode}`)}
    />,
  )
}

try {
  act(() => renderChrome({ kind: 'search' }))
  act(() => newTabButton().click())
  assert.deepEqual(destinations, ['newtab'])

  act(() => renderChrome({ kind: 'dashboard' }))
  act(() => newTabButton().click())
  assert.deepEqual(destinations, ['newtab', 'dashboard'])

  const customAddress = 'qdn://APP/NameOnly'
  act(() =>
    renderChrome(
      { address: customAddress, kind: 'custom' },
      {
        openResult: {
          message: 'Choose a published identifier.',
          options: [
            {
              address: 'qdn://APP/NameOnly/default',
              label: 'default',
            },
          ],
          status: 'choose',
        },
      },
    ),
  )
  await act(async () => {
    newTabButton().click()
    await Promise.resolve()
  })
  assert.deepEqual(addresses, [customAddress])
  assert.equal(
    container.querySelector<HTMLInputElement>('input[aria-label="Address and search"]')
      ?.value,
    customAddress,
  )
  assert.match(container.textContent ?? '', /Choose a published identifier\./)
  assert.ok(
    container.querySelector('select[aria-label="App resource identifier"]'),
    'custom new-tab targets should keep the existing identifier-choice UI',
  )

  act(() =>
    renderChrome(
      { address: 'qdn://APP/Blocked', kind: 'custom' },
      { navigationDisabled: true },
    ),
  )
  assert.equal(newTabButton().disabled, true)
  act(() => newTabButton().click())
  assert.deepEqual(addresses, [customAddress])

  const accountLookup: DualIdentityLookupResult = {
    inputKind: 'address',
    message: 'Fixture identity',
    networks: {
      qortium: {
        address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
        avatar: {
          identifier: 'portrait',
          name: 'Alice',
          service: 'THUMBNAIL',
          source: 'account-pointer',
        },
        detail: '1 registered name',
        matchedQueryName: false,
        names: ['Alice'],
        network: 'qortium',
        primaryName: 'Alice',
        state: 'resolved',
      },
      qortal: {
        address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
        avatar: {
          identifier: 'qortal_avatar',
          name: 'Alice',
          service: 'THUMBNAIL',
          source: 'legacy-name',
        },
        detail: '1 registered name',
        matchedQueryName: false,
        names: ['Alice'],
        network: 'qortal',
        primaryName: 'Alice',
        state: 'resolved',
      },
    },
    query: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
    sharedAddress: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
    state: 'resolved',
  }
  await act(async () => {
    renderChrome({ kind: 'search' }, { selectedAccountLookup: accountLookup })
    await Promise.resolve()
  })
  assert.equal(
    container.querySelectorAll('.home-v2-account-avatars .home-v2-account-avatar').length,
    2,
    'the toolbar account control should show both enabled-network avatars',
  )

  // The trigger is decoration only now: avatars plus a padlock, with the label
  // carried by the accessible name (owner request).
  const accountButton = (): HTMLButtonElement => {
    const button = container.querySelector<HTMLButtonElement>(
      '.home-v2-account-button',
    )
    assert.ok(button, 'the browser chrome should render an account button')
    return button
  }
  assert.equal(accountButton().getAttribute('aria-label'), 'Alice · Unlocked')
  assert.equal(accountButton().getAttribute('title'), 'Alice · Unlocked')
  // Avatar monograms and the padlock are aria-hidden decoration; anything left
  // after removing them would be a visible label, which the trigger must not
  // have any more.
  const visibleTriggerText = (): string => {
    const clone = accountButton().cloneNode(true) as HTMLElement
    for (const node of clone.querySelectorAll('[aria-hidden="true"]')) node.remove()
    return (clone.textContent ?? '').trim()
  }
  assert.equal(
    visibleTriggerText(),
    '',
    'the account trigger must not print any text',
  )
  const lockGlyph = (): SVGElement => {
    const glyph = accountButton().querySelector<SVGElement>('.home-v2-account-lock')
    assert.ok(glyph, 'the account trigger should show a lock-state glyph')
    return glyph
  }
  assert.equal(
    lockGlyph().classList.contains('lucide-lock-open'),
    true,
    'an unlocked account should show the open padlock',
  )

  // Opening a menu must not offer a Dashboard shortcut any more: the item was
  // removed from both dropdowns, and the Dashboard stays reachable elsewhere.
  const openMenuPanel = (triggerSelector: string): HTMLElement => {
    const trigger = container.querySelector<HTMLButtonElement>(triggerSelector)
    assert.ok(trigger, `expected ${triggerSelector} in the toolbar`)
    act(() => trigger.click())
    const panel = trigger
      .closest('.home-v2-chrome-menu')
      ?.querySelector<HTMLElement>('.home-v2-chrome-menu__panel')
    assert.ok(panel, `${triggerSelector} should open a menu in place`)
    return panel
  }
  for (const triggerSelector of ['.home-v2-node-pill', '.home-v2-account-button']) {
    const panel = openMenuPanel(triggerSelector)
    assert.equal(
      [...panel.querySelectorAll('button')].some((button) =>
        /Dashboard/i.test(button.textContent ?? ''),
      ),
      false,
      `${triggerSelector} must no longer offer a Dashboard menu item`,
    )
  }
  const accountPanel = accountButton()
    .closest('.home-v2-chrome-menu')
    ?.querySelector<HTMLElement>('.home-v2-chrome-menu__panel')
  assert.ok(accountPanel, 'the account menu should be open')
  // Both networks share one address here, so it is printed once in its own
  // monospace row rather than repeated per network.
  const addressRows = accountPanel.querySelectorAll(
    '.home-v2-account-detail__address',
  )
  assert.equal(addressRows.length, 1, 'a shared address should be printed once')
  assert.equal(
    addressRows[0]?.textContent,
    'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
  )
  assert.equal(
    accountPanel.querySelectorAll('.home-v2-account-detail[data-network]').length,
    2,
    'each enabled network should get its own detail row',
  )

  const lockedSnapshot: HomeV2Snapshot = {
    ...homeV2Fixture,
    account: { ...homeV2Fixture.account, state: 'locked' as const },
  }
  await act(async () => {
    renderChrome(
      { kind: 'search' },
      { selectedAccountLookup: accountLookup, snapshot: lockedSnapshot },
    )
    await Promise.resolve()
  })
  assert.equal(accountButton().getAttribute('aria-label'), 'Alice · Locked')
  assert.equal(
    lockGlyph().classList.contains('lucide-lock-open'),
    false,
    'a locked account should show the closed padlock',
  )
  assert.equal(lockGlyph().classList.contains('lucide-lock'), true)

  // R3-7: the node menus act on the node instead of only describing it —
  // connection mode, the local Core's start/stop, and one update control.
  const nodePanel = (network: NetworkId): HTMLElement => {
    const trigger = container.querySelector<HTMLButtonElement>(
      `.home-v2-node-pill[data-network="${network}"]`,
    )
    assert.ok(trigger, `expected a ${network} pill in the toolbar`)
    if (trigger.getAttribute('aria-expanded') !== 'true') {
      act(() => trigger.click())
    }
    const panel = trigger
      .closest('.home-v2-chrome-menu')
      ?.querySelector<HTMLElement>('.home-v2-chrome-menu__panel')
    assert.ok(panel, `the ${network} menu should be open`)
    return panel
  }
  const menuControl = (panel: HTMLElement, action: string) =>
    panel.querySelector<HTMLButtonElement>(
      `[data-home-v2-node-menu-action="${action}"]`,
    )

  await act(async () => {
    renderChrome({ kind: 'search' }, { coreManagement: coreManagementFixture })
    await Promise.resolve()
  })
  for (const [network, label] of [
    ['qortium', 'Qortium'],
    ['qortal', 'Qortal'],
  ] as const) {
    const panel = nodePanel(network)
    const select = panel.querySelector<HTMLSelectElement>(
      `select[aria-label="${label} connection mode"]`,
    )
    assert.ok(select, `the ${network} menu should offer a connection-mode control`)
    // Same options, same order, same current-mode semantics as the Dashboard's
    // node card, so the two controls cannot teach different things.
    assert.deepEqual(
      [...select.options].map((option) => option.value),
      ['disabled', 'local', 'public', 'custom'],
    )
    assert.equal(select.value, homeV2Fixture.nodes[network].mode)
    assert.ok(
      menuControl(panel, 'configure'),
      `the ${network} menu should reach the custom-node dialog`,
    )
    assert.ok(
      menuControl(panel, 'settings'),
      `the ${network} menu should link to Settings for anything deeper`,
    )
  }

  // Start/stop follow the Core manager's capabilities: the stopped
  // Home-managed Qortium Core can start, the running adopted Qortal Core can
  // only be stopped, and neither offers the button it is not allowed.
  const qortiumPanel = nodePanel('qortium')
  const startButton = menuControl(qortiumPanel, 'start')
  assert.ok(startButton, 'a startable Core should offer Start Core')
  assert.equal(startButton.disabled, false)
  assert.equal(menuControl(qortiumPanel, 'stop'), null)
  act(() => startButton.click())
  assert.ok(nodeMenuCalls.includes('qortium:start'))

  const qortalStop = menuControl(nodePanel('qortal'), 'stop')
  assert.ok(qortalStop, 'a stoppable Core should offer Stop Core')
  assert.equal(menuControl(nodePanel('qortal'), 'start'), null)
  // Qortal is api-only here, so the menu must ask before asking the Core to
  // exit — the same confirmation the Core card does.
  act(() => qortalStop.click())
  assert.equal(
    nodeMenuCalls.includes('qortal:stop'),
    false,
    'stopping an externally controlled Core must confirm first',
  )
  const confirmPanel = nodePanel('qortal').querySelector('[role="alertdialog"]')
  assert.ok(confirmPanel, 'the api-only stop should raise a confirmation')
  const cancelStop = menuControl(nodePanel('qortal'), 'stop-cancel')
  assert.ok(cancelStop)
  act(() => cancelStop.click())
  assert.equal(nodePanel('qortal').querySelector('[role="alertdialog"]'), null)

  // Nothing actionable yet: a check, and no install button pretending there is
  // something to install.
  assert.ok(menuControl(nodePanel('qortium'), 'check'))
  assert.equal(menuControl(nodePanel('qortium'), 'install'), null)
  assert.equal(menuControl(nodePanel('qortal'), 'install'), null)
  const checkButton = menuControl(nodePanel('qortium'), 'check')
  assert.ok(checkButton)
  act(() => checkButton.click())
  assert.ok(nodeMenuCalls.includes('qortium:check'))

  // Capabilities off: no lifecycle buttons at all, however the menu is opened.
  await act(async () => {
    renderChrome(
      { kind: 'search' },
      {
        coreManagement: {
          ...coreManagementFixture,
          statuses: {
            ...coreManagementFixture.statuses,
            qortium: {
              ...coreManagementFixture.statuses.qortium,
              capabilities: { canStart: false, canStop: false },
            },
          },
        },
      },
    )
    await Promise.resolve()
  })
  assert.equal(menuControl(nodePanel('qortium'), 'start'), null)
  assert.equal(menuControl(nodePanel('qortium'), 'stop'), null)

  const coreMaintenance = coreManagementFixture.coreMaintenance
  const qortalMaintenance = coreManagementFixture.qortalMaintenance
  assert.ok(coreMaintenance)
  assert.ok(qortalMaintenance)
  await act(async () => {
    renderChrome(
      { kind: 'search' },
      {
        coreManagement: {
          ...coreManagementFixture,
          coreMaintenance: {
            ...coreMaintenance,
            release: {
              action: 'strict-update',
              available: true,
              channel: 'stable',
              revision: 1,
              schema: 'home-v2-core-maintenance-release',
              tag: 'v1.7.3',
            },
          },
          qortalMaintenance: {
            ...qortalMaintenance,
            release: {
              action: 'strict-update',
              available: true,
              code: null,
              network: 'qortal',
              revision: 1,
              schema: 'home-v2-qortal-maintenance-release',
              tag: 'v6.3.0',
            },
          },
        },
      },
    )
    await Promise.resolve()
  })
  const qortiumInstall = menuControl(nodePanel('qortium'), 'install')
  assert.ok(qortiumInstall, 'an actionable release should offer one install button')
  assert.equal(qortiumInstall.textContent, 'Install update')
  assert.equal(qortiumInstall.disabled, false)
  assert.equal(
    menuControl(nodePanel('qortium'), 'check'),
    null,
    'the compact menu shows the install button instead of the check, not both',
  )
  const qortalInstall = menuControl(nodePanel('qortal'), 'install')
  assert.ok(qortalInstall)
  assert.equal(qortalInstall.textContent, 'Update Qortal Core')
  act(() => qortalInstall.click())
  assert.ok(nodeMenuCalls.includes('qortal:install'))

  // Interactive controls inside the panel must not trip the outside-pointerdown
  // dismissal, or the menu would close the instant a control is pressed.
  const openTrigger = container.querySelector<HTMLButtonElement>(
    '.home-v2-node-pill[data-network="qortium"]',
  )
  assert.ok(openTrigger)
  const modeSelect = nodePanel('qortium').querySelector('select')
  assert.ok(modeSelect)
  act(() => {
    modeSelect.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  })
  assert.equal(
    openTrigger.getAttribute('aria-expanded'),
    'true',
    'a pointer press on a control inside the menu must not dismiss it',
  )
  act(() => {
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  })
  assert.equal(
    openTrigger.getAttribute('aria-expanded'),
    'false',
    'a pointer press outside the menu must still dismiss it',
  )

  // Custom stays unreachable until it is configured, and says why.
  const customUnconfigured: HomeV2Snapshot = {
    ...homeV2Fixture,
    nodes: {
      ...homeV2Fixture.nodes,
      qortium: { ...homeV2Fixture.nodes.qortium, customConfigured: false },
    },
  }
  await act(async () => {
    renderChrome(
      { kind: 'search' },
      { coreManagement: coreManagementFixture, snapshot: customUnconfigured },
    )
    await Promise.resolve()
  })
  const unconfiguredSelect = nodePanel('qortium').querySelector('select')
  assert.ok(unconfiguredSelect)
  const customOption = [...unconfiguredSelect.options].find(
    (option) => option.value === 'custom',
  )
  assert.ok(customOption)
  assert.equal(customOption.disabled, true)
  assert.match(customOption.textContent ?? '', /not configured/)
  const settingsLink = menuControl(nodePanel('qortium'), 'settings')
  assert.ok(settingsLink)
  act(() => settingsLink.click())
  assert.ok(nodeMenuCalls.includes('core-settings'))
  // An item that takes the user somewhere else has to close the popover behind
  // it; the controls that act in place (mode, start/stop, update) do not.
  assert.equal(
    container
      .querySelector('.home-v2-node-pill[data-network="qortium"]')
      ?.getAttribute('aria-expanded'),
    'false',
    'the Settings item should close the menu it navigates away from',
  )

  // Without a Core manager the menu keeps its connection half and simply drops
  // the Core half, rather than rendering dead buttons.
  await act(async () => {
    renderChrome({ kind: 'search' })
    await Promise.resolve()
  })
  assert.ok(nodePanel('qortium').querySelector('select'))
  assert.equal(nodePanel('qortium').querySelector('.home-v2-node-menu-core'), null)

  const qortalDisabled = {
    ...homeV2Fixture,
    nodes: {
      ...homeV2Fixture.nodes,
      qortal: { ...homeV2Fixture.nodes.qortal, mode: 'disabled' as const },
    },
  }
  await act(async () => {
    renderChrome(
      { kind: 'search' },
      { selectedAccountLookup: accountLookup, snapshot: qortalDisabled },
    )
    await Promise.resolve()
  })
  assert.equal(
    container.querySelectorAll('.home-v2-account-avatars .home-v2-account-avatar').length,
    1,
    'disabled-network avatars should be hidden with the rest of that network',
  )
} finally {
  act(() => root.unmount())
  container.remove()
}

console.log('Home v2 browser chrome interaction tests passed.')
