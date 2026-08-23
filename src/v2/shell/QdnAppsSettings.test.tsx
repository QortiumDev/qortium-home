import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { defaultHomeV2Appearance } from '../appearance'
import { HOME_V2_NOTIFICATION_POLICY_SCHEMA } from '../../home-v2-live/notification-policy-client'
import {
  createHomeV2QdnSettingsClient,
  type HomeV2QdnSettingsAdapter,
} from '../../home-v2-live/qdn-settings-client'
import { SettingsPage } from './SettingsPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function initialState() {
  return {
    assignments: {
      assignments: {
        bookmarks: {
          description: 'App used when Home opens bookmarks.',
          label: 'Bookmarks',
          url: 'qdn://APP/Bookmarks/Bookmarks',
        },
        notifications: {
          description: 'App used to manage Home notifications.',
          label: 'Notifications',
          url: 'qdn://APP/Notify/Notify',
        },
        explore: {
          description: 'App used when Home opens QDN Explore.',
          label: 'Explore',
          url: 'qdn://APP/Explore/Explore',
        },
      },
      revision: 3,
      version: 2 as const,
    },
    notifications: {
      apps: [{
        appKey: 'qdn://APP/Notify/Notify',
        grantedAt: '2026-08-22T12:00:00.000Z',
        hasForeignPaymentRule: true,
        muted: true,
        ruleCount: 2,
      }],
      revision: 7 as number | null,
      status: 'available' as const,
      version: 1 as const,
    },
    revision: 1 as const,
    schema: 'home-v2-qdn-settings-state' as const,
  }
}

let state = initialState()
const assignmentRequests: unknown[] = []
const muteRequests: unknown[] = []
const revokeRequests: unknown[] = []
let subscriptionListener: (() => void) | null = null
let releaseRead: (() => void) | null = null
let blockNextRead = false
const adapter: HomeV2QdnSettingsAdapter = {
  async get() {
    if (blockNextRead) {
      blockNextRead = false
      await new Promise<void>((resolve) => { releaseRead = resolve })
    }
    return state
  },
  subscribe(listener) {
    subscriptionListener = listener
    return () => { subscriptionListener = null }
  },
  async setAssignment(request) {
    assignmentRequests.push(request)
    const current = state.assignments.assignments[request.role as keyof typeof state.assignments.assignments]
    assert(current)
    state = {
      ...state,
      assignments: {
        ...state.assignments,
        assignments: {
          ...state.assignments.assignments,
          [request.role]: { ...current, url: request.url },
        },
        revision: state.assignments.revision + 1,
      },
    }
    return state
  },
  async setMuted(request) {
    muteRequests.push(request)
    state = {
      ...state,
      notifications: {
        ...state.notifications,
        apps: state.notifications.apps.map((grant) =>
          grant.appKey === request.appKey
            ? { ...grant, muted: request.muted }
            : grant),
        revision: (state.notifications.revision ?? 0) + 1,
      },
    }
    return state
  },
  async revoke(request) {
    revokeRequests.push(request)
    state = {
      ...state,
      notifications: {
        ...state.notifications,
        apps: state.notifications.apps.filter(({ appKey }) => appKey !== request.appKey),
        revision: (state.notifications.revision ?? 0) + 1,
      },
    }
    return state
  },
}
const client = createHomeV2QdnSettingsClient(adapter)

const container = document.createElement('div')
document.body.appendChild(container)
const root = createRoot(container)

function button(label: string, within: ParentNode = container) {
  const found = [...within.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === label)
  assert(found, `expected button ${label}`)
  return found as HTMLButtonElement
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set
  assert(setter)
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

await act(async () => {
  root.render(
    <SettingsPage
      account={{
        lockOnExit: true,
        manuallyLocked: false,
        rememberUnlock: false,
        secureStorageAvailable: true,
        selectedIdentityId: null,
        state: 'none',
      }}
      appearance={defaultHomeV2Appearance}
      newTabPreference={{ kind: 'search' }}
      qdnAppsManagement={{ available: true, client }}
      requestedSection="notifications"
    />,
  )
})

assert.ok(button('QDN Apps'), 'QDN Apps remains visible without an account')
assert.equal(button('QDN Apps').getAttribute('aria-current'), 'page')
assert.equal(
  [...container.querySelectorAll('nav button')]
    .some((candidate) => candidate.textContent?.trim() === 'Account'),
  false,
)

blockNextRead = true
await act(async () => {
  subscriptionListener?.()
  await settle()
})
assert.equal(
  [...container.querySelectorAll('[data-home-v2-qdn-settings] button, [data-home-v2-qdn-settings] input')].every((control) =>
    (control as HTMLButtonElement | HTMLInputElement).disabled),
  true,
  'a subscription refresh must disable stale-revision actions',
)
await act(async () => {
  releaseRead?.()
  await settle()
})

assert.match(container.textContent ?? '', /assigned app still asks/i)
assert.deepEqual(
  [...container.querySelectorAll('[data-qdn-assignment-role]')]
    .map((row) => row.getAttribute('data-qdn-assignment-role')),
  ['bookmarks', 'notifications', 'explore'],
)

const exploreRow = container.querySelector('[data-qdn-assignment-role="explore"]') as HTMLElement
const exploreInput = exploreRow.querySelector('input') as HTMLInputElement
await act(async () => {
  setInputValue(exploreInput, 'qdn://app/OtherExplore/OtherExplore')
})
await act(async () => {
  button('Save', exploreRow).click()
  await settle()
})
assert.equal(assignmentRequests.length, 1)
assert.deepEqual(assignmentRequests[0], {
  expectedAssignmentRevision: 3,
  role: 'explore',
  url: 'qdn://APP/OtherExplore/OtherExplore',
})

const updatedExploreRow = container.querySelector('[data-qdn-assignment-role="explore"]') as HTMLElement
await act(async () => {
  button('Use default', updatedExploreRow).click()
  await settle()
})
assert.equal(assignmentRequests.length, 2)
assert.deepEqual(assignmentRequests[1], {
  expectedAssignmentRevision: 4,
  role: 'explore',
  url: 'qdn://APP/Explore/Explore',
})

const grantCard = container.querySelector('[data-qdn-notification-grant]') as HTMLElement
assert.match(grantCard.textContent ?? '', /qdn:\/\/APP\/Notify\/Notify/)
assert.match(grantCard.textContent ?? '', /Granted/)
assert.match(grantCard.textContent ?? '', /2 subscription rules/)
assert.ok(grantCard.querySelector('[data-qdn-foreign-payment-warning="true"]'))
const mute = grantCard.querySelector('input[type="checkbox"]') as HTMLInputElement
assert.equal(mute.checked, true)
await act(async () => {
  mute.click()
  await settle()
})
assert.equal(muteRequests.length, 1)
assert.deepEqual(muteRequests[0], {
  appKey: 'qdn://APP/Notify/Notify',
  expectedNotificationRevision: 7,
  muted: false,
})

const currentGrantCard = container.querySelector('[data-qdn-notification-grant]') as HTMLElement
await act(async () => {
  button('Revoke', currentGrantCard).click()
})
assert.equal(revokeRequests.length, 0, 'first click only opens the confirmation')
const confirmation = currentGrantCard.querySelector('[data-qdn-revoke-confirm="true"]') as HTMLElement
assert.match(confirmation.textContent ?? '', /Revoke access and remove 2 subscription rules\?/)
await act(async () => {
  button('Revoke', confirmation).click()
  await settle()
})
assert.equal(revokeRequests.length, 1)
assert.deepEqual(revokeRequests[0], {
  appKey: 'qdn://APP/Notify/Notify',
  expectedNotificationRevision: 8,
})
assert.ok(container.querySelector('[data-qdn-notification-empty="true"]'))

await act(async () => {
  root.render(
    <SettingsPage
      account={{
        lockOnExit: true,
        manuallyLocked: false,
        rememberUnlock: false,
        secureStorageAvailable: true,
        selectedIdentityId: null,
        state: 'none',
      }}
      appearance={defaultHomeV2Appearance}
      newTabPreference={{ kind: 'search' }}
      qdnAppsManagement={{ available: true, client }}
    />,
  )
  await settle()
})
assert.equal(button('General').getAttribute('aria-current'), 'page')

await act(async () => {
  button('QDN Apps').click()
  await settle()
})
assert.equal(button('QDN Apps').getAttribute('aria-current'), 'page')

await act(async () => {
  root.render(
    <SettingsPage
      account={{
        lockOnExit: true,
        manuallyLocked: false,
        rememberUnlock: false,
        secureStorageAvailable: true,
        selectedIdentityId: null,
        state: 'none',
      }}
      appearance={defaultHomeV2Appearance}
      newTabPreference={{ kind: 'search' }}
      qdnAppsManagement={{ available: false }}
    />,
  )
  await settle()
})
assert.equal(button('General').getAttribute('aria-current'), 'page')
assert.equal(
  [...container.querySelectorAll('nav button')].some(
    (candidate) => candidate.textContent?.trim() === 'QDN Apps',
  ),
  false,
)

const policyRequests: boolean[] = []
await act(async () => {
  root.render(
    <SettingsPage
      account={{
        lockOnExit: true,
        manuallyLocked: false,
        rememberUnlock: false,
        secureStorageAvailable: true,
        selectedIdentityId: null,
        state: 'none',
      }}
      appearance={defaultHomeV2Appearance}
      newTabPreference={{ kind: 'search' }}
      notificationPolicy={{
        enabled: true,
        generation: 2,
        schema: HOME_V2_NOTIFICATION_POLICY_SCHEMA,
        status: 'available',
        version: 1,
      }}
      onSetAppNotifications={async (enabled) => {
        policyRequests.push(enabled)
      }}
    />,
  )
  await settle()
})
const policySwitch = container.querySelector(
  'input[aria-label="App notifications"]',
) as HTMLInputElement
assert.equal(policySwitch.checked, true)
assert.equal(policySwitch.disabled, false)
await act(async () => {
  policySwitch.click()
  await settle()
})
assert.deepEqual(policyRequests, [false])

await act(async () => {
  root.render(
    <SettingsPage
      account={{
        lockOnExit: true,
        manuallyLocked: false,
        rememberUnlock: false,
        secureStorageAvailable: true,
        selectedIdentityId: null,
        state: 'none',
      }}
      appearance={defaultHomeV2Appearance}
      newTabPreference={{ kind: 'search' }}
      notificationPolicy={{
        enabled: true,
        generation: 2,
        schema: HOME_V2_NOTIFICATION_POLICY_SCHEMA,
        status: 'available',
        version: 1,
      }}
      onSetAppNotifications={async () => {
        throw new Error('injected persistence failure')
      }}
    />,
  )
  await settle()
})
await act(async () => {
  const failedPolicySwitch = container.querySelector(
    'input[aria-label="App notifications"]',
  ) as HTMLInputElement
  failedPolicySwitch.click()
  await settle()
})
assert.equal(
  [...container.querySelectorAll('[role="alert"]')]
    .some((element) => element.textContent === 'Error'),
  true,
)

await act(async () => root.unmount())
container.remove()
console.log('Home 2 QDN app settings tests passed.')
