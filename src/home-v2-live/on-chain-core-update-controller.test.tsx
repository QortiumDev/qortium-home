import assert from 'node:assert/strict'
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { OnChainCoreUpdateSettings } from '../v2/shell/OnChainCoreUpdateSettings'
import type { HomeV2NodeClient } from './node-client'
import {
  useHomeV2OnChainCoreUpdates,
  type HomeV2OnChainCoreUpdates,
} from './on-chain-core-update-controller'

function clientFixture(overrides: {
  readonly checkCoreUpdate?: () => Promise<unknown>
  readonly installCoreUpdate?: () => Promise<unknown>
}): HomeV2NodeClient {
  return overrides as unknown as HomeV2NodeClient
}

function Harness({
  authenticated,
  authorityRevision,
  client,
  onState,
}: {
  readonly authenticated: boolean
  readonly authorityRevision?: number
  readonly client: HomeV2NodeClient
  readonly onState: (state: HomeV2OnChainCoreUpdates) => void
}) {
  const state = useHomeV2OnChainCoreUpdates(client, {
    authenticated,
    authorityRevision,
    available: true,
  })
  useEffect(() => onState(state), [onState, state])
  return <OnChainCoreUpdateSettings updates={state} />
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (predicate()) return
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  throw new Error('Timed out waiting for the on-chain Core update controller.')
}

const rootElement = document.createElement('div')
document.body.append(rootElement)
const root = createRoot(rootElement)
let checks = 0
let installs = 0
let latest: HomeV2OnChainCoreUpdates | null = null
const client = clientFixture({
  checkCoreUpdate: async () => {
    checks += 1
    return {
      autoUpdateMode: 'NOTIFY',
      commitHash: 'abcdef0123456789',
      updateAvailable: true,
    }
  },
  installCoreUpdate: async () => {
    installs += 1
    return {
      autoUpdateMode: 'NOTIFY',
      installStarted: true,
      status: 'INSTALL_IN_PROGRESS',
      updateAvailable: true,
    }
  },
})

await act(async () => {
  root.render(
    <Harness
      authenticated={false}
      client={client}
      onState={(state) => { latest = state }}
    />,
  )
})
await waitFor(() => latest !== null)
assert.equal(checks, 0)
assert.match(rootElement.textContent ?? '', /Save the custom node API key/)
assert.equal(
  (rootElement.querySelector(
    '[data-home-v2-on-chain-core-update-action="check"]',
  ) as HTMLButtonElement).disabled,
  true,
)

await act(async () => {
  root.render(
    <Harness
      authenticated
      client={client}
      onState={(state) => { latest = state }}
    />,
  )
})
await waitFor(() => checks === 1 && latest?.busy === null)
assert.equal((latest as HomeV2OnChainCoreUpdates | null)?.canInstall, true)
assert.match(rootElement.textContent ?? '', /Approved Core update available/)
const installButton = rootElement.querySelector(
  '[data-home-v2-on-chain-core-update-action="install"]',
) as HTMLButtonElement
assert.equal(installButton.textContent?.trim(), 'Install approved update')

await act(async () => { installButton.click() })
await waitFor(() => installs === 1 && latest?.busy === null)
assert.equal((latest as HomeV2OnChainCoreUpdates | null)?.canInstall, false)
assert.match(rootElement.textContent ?? '', /install has been scheduled/)
assert.equal(
  rootElement.querySelector(
    '[data-home-v2-on-chain-core-update-action="install"]',
  ),
  null,
)

await act(async () => {
  root.render(
    <Harness
      authenticated
      authorityRevision={1}
      client={client}
      onState={(state) => { latest = state }}
    />,
  )
})
await waitFor(() => checks === 2 && latest?.busy === null)
assert.equal((latest as HomeV2OnChainCoreUpdates | null)?.canInstall, true)

await act(async () => { root.unmount() })
rootElement.remove()

const malformedElement = document.createElement('div')
document.body.append(malformedElement)
const malformedRoot = createRoot(malformedElement)
let malformed: HomeV2OnChainCoreUpdates | null = null
await act(async () => {
  malformedRoot.render(
    <Harness
      authenticated
      client={clientFixture({
        checkCoreUpdate: async () => 'not-json',
        installCoreUpdate: async () => ({}),
      })}
      onState={(state) => { malformed = state }}
    />,
  )
})
await waitFor(() => malformed?.busy === null && malformed?.tone === 'danger')
assert.match(
  (malformed as HomeV2OnChainCoreUpdates | null)?.message ?? '',
  /response was invalid/i,
)
assert.equal(malformedElement.querySelector('[data-tone="danger"]') !== null, true)
await act(async () => { malformedRoot.unmount() })
malformedElement.remove()

console.log('Home 2 on-chain Core update controller tests passed.')
