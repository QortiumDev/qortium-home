import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { HomeV2CoreManagement } from './CoreManagerCards'
import { CoreManagerCards } from './CoreManagerCards'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const container = document.createElement('div')
document.body.appendChild(container)
const root = createRoot(container)
const actions: string[] = []

const management: HomeV2CoreManagement = {
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
  onAction: (network, action) => actions.push(`${network}:${action}`),
  onRefresh: () => actions.push('refresh'),
}

function buttonIn(network: string, label: string) {
  const card = container.querySelector(`[data-network="${network}"]`)
  assert.ok(card)
  const button = [...card.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  assert.ok(button, `${network} should render ${label}`)
  return button as HTMLButtonElement
}

try {
  act(() => root.render(<CoreManagerCards management={management} />))
  const cards = [...container.querySelectorAll('.home-v2-core-card')]
  assert.equal(cards.length, 2)
  assert.equal(cards[0]?.getAttribute('data-network'), 'qortium')
  assert.equal(cards[1]?.getAttribute('data-network'), 'qortal')

  act(() => buttonIn('qortal', 'Stop Core').click())
  assert.deepEqual(actions, [])
  assert.ok(container.querySelector('[role="alertdialog"]'))
  assert.match(
    container.textContent ?? '',
    /externally controlled Qortal Core/,
  )
  act(() => buttonIn('qortal', 'Cancel').click())
  assert.equal(container.querySelector('[role="alertdialog"]'), null)

  act(() => buttonIn('qortal', 'Stop Core').click())
  const confirmation = container.querySelector('[role="alertdialog"]')
  assert.ok(confirmation)
  const confirm = [...confirmation.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Stop Core',
  )
  assert.ok(confirm)
  act(() => (confirm as HTMLButtonElement).click())
  assert.deepEqual(actions, ['qortal:stop'])

  act(() =>
    root.render(
      <CoreManagerCards
        management={{
          ...management,
          busyActions: { qortal: null, qortium: 'start' },
        }}
      />,
    ),
  )
  assert.equal(buttonIn('qortium', 'Starting').disabled, true)
  assert.equal(buttonIn('qortal', 'Stop Core').disabled, false)

  act(() =>
    root.render(
      <CoreManagerCards
        management={{
          ...management,
          lastActions: {
            qortal: null,
            qortium: {
              action: 'start',
              failed: false,
              network: 'qortium',
              result: {
                code: null,
                network: 'qortium',
                outcome: 'completed',
                revision: 1,
                schema: 'home-v2-core-manager-action',
                status: {
                  ...management.statuses.qortium,
                  capabilities: { canStart: false, canStop: true },
                  runtime: 'running',
                },
                warning: 'operation-lock-release-failed',
              },
            },
          },
        }}
      />,
    ),
  )
  assert.match(container.textContent ?? '', /could not release its operation lock/)

  act(() =>
    root.render(
      <CoreManagerCards
        management={{
          ...management,
          lastActions: {
            qortal: null,
            qortium: {
              action: 'start',
              failed: false,
              network: 'qortium',
              result: {
                code: 'operation-in-progress',
                network: 'qortium',
                outcome: 'blocked',
                revision: 1,
                schema: 'home-v2-core-manager-action',
                status: management.statuses.qortium,
                warning: 'operation-lock-release-failed',
              },
            },
          },
        }}
      />,
    ),
  )
  assert.match(container.textContent ?? '', /Another Core action is already in progress/)
  assert.match(container.textContent ?? '', /could not release its operation lock/)
  assert.doesNotMatch(container.textContent ?? '', /The action completed/)

  act(() =>
    root.render(
      <CoreManagerCards
        management={{
          ...management,
          statuses: {
            ...management.statuses,
            qortium: {
              ...management.statuses.qortium,
              capabilities: { canStart: false, canStop: true },
              issue: 'runtime-blocked',
              runtime: 'running',
            },
          },
        }}
      />,
    ),
  )
  assert.match(container.textContent ?? '', /Runtime needs reset/)
  assert.ok(buttonIn('qortium', 'Stop Core'))

  act(() =>
    root.render(
      <CoreManagerCards management={management} networks={['qortal']} />,
    ),
  )
  assert.equal(container.querySelector('[data-network="qortium"]'), null)
  assert.ok(container.querySelector('[data-network="qortal"]'))

  act(() =>
    root.render(
      <CoreManagerCards management={{ ...management, available: false }} />,
    ),
  )
  assert.equal(container.textContent, '')
} finally {
  act(() => root.unmount())
  container.remove()
}

console.log('home v2 Core manager card tests passed')
