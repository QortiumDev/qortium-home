import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createProductState } from '../product-model'
import { homeV2Fixture } from '../test-kit/fixtures'
import { BrowserChrome, type AddressOpenResult } from './BrowserChrome'
import type { DualIdentityLookupResult, HomeV2Snapshot } from '../contracts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const container = document.createElement('div')
document.body.appendChild(container)
const root = createRoot(container)
const destinations: string[] = []
const addresses: string[] = []

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
