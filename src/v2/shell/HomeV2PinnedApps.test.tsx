import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DashboardPin } from '../../dashboardPins'
import { HomeV2PinnedApps, type HomeV2PinnedAppsProps } from './HomeV2PinnedApps'

const callbacks = {
  onAdd: async () => undefined,
  onMove: async () => undefined,
  onOpen: async () => undefined,
  onRemove: async () => undefined,
  onRename: async () => undefined,
  onRetry: async () => undefined,
} satisfies Pick<
  HomeV2PinnedAppsProps,
  'onAdd' | 'onMove' | 'onOpen' | 'onRemove' | 'onRename' | 'onRetry'
>

const pins: DashboardPin[] = [
  {
    createdAt: 1,
    displayUrl: 'qdn://APP/Chat/Chat',
    id: 'chat',
    label: 'Chat',
  },
  {
    createdAt: 2,
    customLabel: 'My saved place',
    displayUrl: 'home://bookmarks',
    id: 'saved-place',
    label: 'Bookmarks',
  },
]

const ready = renderToStaticMarkup(
  <HomeV2PinnedApps {...callbacks} pins={pins} status="ready" />,
)
assert.match(ready, /Pinned apps/)
assert.match(ready, /qdn:\/\/APP\/Chat\/Chat/)
assert.match(ready, /My saved place/)
assert.match(ready, /home:\/\/bookmarks/)
assert.match(ready, /aria-label="Open Chat"/)
assert.match(ready, /aria-label="Back: Chat" disabled=""/)
assert.match(ready, /aria-label="Forward: Chat"/)
assert.match(ready, /aria-label="Forward: My saved place" disabled=""/)
assert.match(ready, /aria-label="Rename My saved place"/)
assert.match(ready, /aria-label="Remove My saved place"/)

const empty = renderToStaticMarkup(
  <HomeV2PinnedApps {...callbacks} pins={[]} status="ready" />,
)
assert.match(empty, /No dashboard pins yet\./)
assert.match(empty, /aria-expanded="false"/)

const loading = renderToStaticMarkup(
  <HomeV2PinnedApps {...callbacks} pins={[]} status="loading" />,
)
assert.match(loading, /role="status"/)
assert.match(loading, /Loading…/)
assert.match(loading, /aria-busy="true"/)

const failed = renderToStaticMarkup(
  <HomeV2PinnedApps
    {...callbacks}
    error="Pinned apps could not be loaded."
    pins={[]}
    status="error"
  />,
)
assert.match(failed, /role="alert"/)
assert.match(failed, /Pinned apps could not be loaded\./)
assert.match(failed, />Retry</)

console.log('Home v2 pinned apps UI tests passed.')
