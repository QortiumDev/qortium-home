import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { HomeV2ViewerTab } from './HomeV2ViewerTab'
import { defaultHomeV2Appearance } from '../appearance'
import type { TabId } from '../contracts'

const container = document.createElement('div')
document.body.append(container)
const root = createRoot(container)
const opens: string[] = [], closes: string[] = []
window.homeV2RetainedViewer = {
  openPublic: async request => {
    opens.push(request.location)
    return { sourceTabId: request.viewerId, name: 'Public', network: 'qortium',
      service: 'FILE', identifier: null, path: null, filename: 'public.bin', mimeType: null,
      streamUrl: 'qortium-home-resource://stream/fixture' }
  },
  closePublic: async id => { closes.push(id) },
  readBytes: async () => ({ bytes: new Uint8Array(), contentType: null }),
  save: async () => ({ canceled: true }), saveBytes: async () => ({ canceled: true }),
}
await act(async () => { root.render(<HomeV2ViewerTab
  entry={{ kind: 'viewer', id: 'public-tab' as TabId, location: 'qdn://FILE/Public/default', accountId: null, title: 'Public' }}
  appearance={defaultHomeV2Appearance} routeKey="node-a" onClose={() => undefined} />) })
assert.equal(opens.length, 1)
assert.ok(container.querySelector('[role="region"]'))
assert.equal(container.querySelector('[aria-modal="true"]'), null)
await act(async () => { window.dispatchEvent(new Event('home-v2-public-viewers-invalidated')) })
assert.equal(opens.length, 2, 'Mounted viewer reacquires access after Android app/private stream revocation')
assert.deepEqual(closes, ['public-tab'], 'The old public binding is closed before replacement')
await act(async () => { root.unmount() })
assert.deepEqual(closes, ['public-tab', 'public-tab'])
window.dispatchEvent(new Event('home-v2-public-viewers-invalidated'))
assert.equal(opens.length, 2, 'Unmounted viewers do not reopen themselves')
// Check the production invalidation ordering as well as the real mounted hook.
const live = readFileSync('src/home-v2-live/HomeV2LiveApp.tsx', 'utf8')
assert.match(live, /releaseHomeV2AndroidResourceStreams\(\)\)\s*\.then\(\(\) => window\.dispatchEvent\(new Event\('home-v2-public-viewers-invalidated'\)\)\)/)
console.log('Viewer nonmodal presentation and Android revocation-to-reacquisition integration passed')
