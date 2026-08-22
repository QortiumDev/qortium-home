import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { HomeV2CoreManagerClient } from '../../home-v2-live/core-manager-client'
import type { HomeV2CoreManagement } from './CoreManagerCards'
import { CoreMaintenancePanel } from './CoreMaintenancePanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const status = {
  capabilities: { canInitialInstall: true, canInstallJava: true },
  core: { channel: null, installedVersion: null, runtime: 'stopped' },
  java: { source: 'missing', updateAvailable: false, version: null },
  revision: 1,
  schema: 'home-v2-core-maintenance',
} as const
const actions: string[] = []
const client: HomeV2CoreManagerClient = {
  getMaintenanceStatus: async () => status,
  checkMaintenanceRelease: async () => ({
    action: 'initial-install', available: true, channel: 'prerelease', revision: 1,
    schema: 'home-v2-core-maintenance-release', tag: 'v1.2.3',
  }),
  runMaintenanceAction: async (action, release) => {
    actions.push(`${action}:${release?.expectedTag ?? ''}`)
    return { code: null, outcome: 'completed', revision: 1,
      schema: 'home-v2-core-maintenance-action', status }
  },
  getStatus: async () => ({} as never),
  start: async () => ({} as never),
  stop: async () => ({} as never),
}
window.homeV2CoreManagers = client

const management = {
  available: true,
  busyActions: { qortal: null, qortium: null },
  lastActions: { qortal: null, qortium: null },
  statuses: {} as never,
} satisfies HomeV2CoreManagement
const container = document.createElement('div')
document.body.appendChild(container)
const root = createRoot(container)

function button(label: string) {
  const found = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)
  assert(found, `expected button ${label}`)
  return found as HTMLButtonElement
}

try {
  await act(async () => {
    root.render(<CoreMaintenancePanel management={management} />)
    await Promise.resolve()
  })
  assert.match(container.textContent ?? '', /Qortium Core maintenance/)
  assert.match(container.textContent ?? '', /Not installed/)
  assert.equal(container.querySelector('select'), null)
  assert.ok(button('Install Java'))

  await act(async () => { button('Check release').click(); await Promise.resolve() })
  assert.match(container.textContent ?? '', /v1\.2\.3 is ready for installation/)
  await act(async () => { button('Install Core').click(); await Promise.resolve() })
  assert.deepEqual(actions, ['initial-install:v1.2.3'])
  assert.match(container.textContent ?? '', /maintenance completed/)

  await act(async () => { button('Install Java').click(); await Promise.resolve() })
  assert.deepEqual(actions, ['initial-install:v1.2.3', 'install-java:'])
} finally {
  act(() => root.unmount())
  delete window.homeV2CoreManagers
  container.remove()
}

console.log('Home v2 Core maintenance panel tests passed.')
