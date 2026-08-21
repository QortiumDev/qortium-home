import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createProductState } from '../product-model'
import { homeV2Fixture } from '../test-kit/fixtures'
import { BrowserChrome, type AddressOpenResult } from './BrowserChrome'

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
  } = {},
): void {
  root.render(
    <BrowserChrome
      snapshot={homeV2Fixture}
      productState={createProductState()}
      navigationDisabled={options.navigationDisabled}
      newTabPreference={newTabPreference}
      onNavigate={(destination) => destinations.push(destination)}
      onOpenAddress={async (address) => {
        addresses.push(address)
        return options.openResult ?? { status: 'opened' }
      }}
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
} finally {
  act(() => root.unmount())
  container.remove()
}

console.log('Home v2 browser chrome interaction tests passed.')
