// Settings > Core could show a Core's version, channel, update policy and
// release, and offer no way to reach the node it belongs to: the custom-node
// dialog and the Core API docs existed only on the Dashboard card. Rather than
// grow a second copy of the connection UI here, Settings links out to the SAME
// shell overlay the Dashboard opens.
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { NetworkId } from '../contracts'
import { homeV2Fixture } from '../test-kit/fixtures'
import type { HomeV2CoreManagement } from './CoreManagerCards'
import { SettingsPage } from './SettingsPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

const container = document.createElement('div')
document.body.appendChild(container)
const root = createRoot(container)
const configured: NetworkId[] = []
const docsOpened: NetworkId[] = []

const action = (network: NetworkId, name: string) =>
  container.querySelector<HTMLButtonElement>(
    `[data-home-v2-settings-node-actions="${network}"] ` +
    `[data-home-v2-settings-node-action="${name}"]`,
  )

try {
  await act(async () => {
    root.render(
      <SettingsPage
        account={homeV2Fixture.account}
        appearance={homeV2Fixture.appearance}
        nodes={homeV2Fixture.nodes}
        newTabPreference={{ kind: 'dashboard' }}
        requestedSection="core"
        coreManagement={coreManagement}
        onConfigureCustomNode={(network) => configured.push(network)}
        onOpenCoreDocs={(network) => docsOpened.push(network)}
      />,
    )
  })

  // One pair per network section, next to that network's own Core controls.
  for (const network of ['qortium', 'qortal'] as const) {
    const configure = action(network, 'configure')
    const docs = action(network, 'core-docs')
    assert.ok(configure, `${network}: Settings must offer the connection dialog`)
    assert.ok(docs, `${network}: Settings must offer the Core API docs`)
    act(() => configure.click())
    act(() => docs.click())
  }
  assert.deepEqual(configured, ['qortium', 'qortal'])
  assert.deepEqual(docsOpened, ['qortium', 'qortal'])

  // The connection UI itself is NOT duplicated here: the Dashboard card owns
  // the mode select, and two places to change one setting is how they drift.
  assert.equal(container.querySelector('.home-v2-node-mode-control'), null)

  // Each link is gated on ITS OWN callback: a host that can open the connection
  // dialog but not the docs (or the other way round) must still get the one it
  // can, rather than both or neither.
  configured.length = 0
  await act(async () => {
    root.render(
      <SettingsPage
        account={homeV2Fixture.account}
        appearance={homeV2Fixture.appearance}
        nodes={homeV2Fixture.nodes}
        newTabPreference={{ kind: 'dashboard' }}
        requestedSection="core"
        coreManagement={coreManagement}
        onConfigureCustomNode={(network) => configured.push(network)}
      />,
    )
  })
  const configureOnly = action('qortium', 'configure')
  assert.ok(configureOnly, 'the connection dialog must still be offered on its own')
  assert.equal(action('qortium', 'core-docs'), null, 'no dead docs link without a handler')
  act(() => configureOnly.click())
  assert.deepEqual(configured, ['qortium'])

  docsOpened.length = 0
  await act(async () => {
    root.render(
      <SettingsPage
        account={homeV2Fixture.account}
        appearance={homeV2Fixture.appearance}
        nodes={homeV2Fixture.nodes}
        newTabPreference={{ kind: 'dashboard' }}
        requestedSection="core"
        coreManagement={coreManagement}
        onOpenCoreDocs={(network) => docsOpened.push(network)}
      />,
    )
  })
  const docsOnly = action('qortium', 'core-docs')
  assert.ok(docsOnly, 'the docs link must still be offered on its own')
  assert.equal(action('qortium', 'configure'), null, 'no dead configure link without a handler')
  act(() => docsOnly.click())
  assert.deepEqual(docsOpened, ['qortium'])

  // A host that cannot open either one offers neither, rather than dead links.
  await act(async () => {
    root.render(
      <SettingsPage
        account={homeV2Fixture.account}
        appearance={homeV2Fixture.appearance}
        nodes={homeV2Fixture.nodes}
        newTabPreference={{ kind: 'dashboard' }}
        requestedSection="core"
        coreManagement={coreManagement}
      />,
    )
  })
  assert.equal(action('qortium', 'configure'), null)
  assert.equal(action('qortium', 'core-docs'), null)
  assert.equal(
    container.querySelector('[data-home-v2-settings-node-actions]'),
    null,
    'the wrapper itself must not render empty',
  )
} finally {
  act(() => root.unmount())
  container.remove()
}

console.log('Home 2 Settings Core action tests passed.')
