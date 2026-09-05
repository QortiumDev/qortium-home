import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DashboardPin } from '../../dashboardPins'
import { SAVED_GUEST_ACCOUNT_ID } from '../../bookmarkManagerContract'
import type { HomeV2AccountCatalogueEntry } from '../contracts'
import { HomeV2PinnedApps, type HomeV2PinnedAppsProps } from './HomeV2PinnedApps'

const callbacks = {
  onAdd: async () => undefined,
  onMove: async () => undefined,
  onOpen: async () => undefined,
  onReorder: async () => undefined,
  onRemove: async () => undefined,
  onRename: async () => undefined,
  onRetry: async () => undefined,
} satisfies Pick<
  HomeV2PinnedAppsProps,
  | 'onAdd'
  | 'onMove'
  | 'onOpen'
  | 'onRemove'
  | 'onRename'
  | 'onReorder'
  | 'onRetry'
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
assert.match(ready, /My saved place/)
assert.match(ready, /aria-label="Open Chat"/)
assert.match(ready, /aria-haspopup="menu"/)
assert.match(ready, /class="home-v2-pinned-apps__grid"/)
assert.match(ready, /home-v2-app-icon--pin/)
assert.match(ready, /home-v2-app-icon__monogram">C</)
assert.doesNotMatch(ready, /qdn:\/\/APP\/Chat\/Chat/)
assert.doesNotMatch(ready, /home:\/\/bookmarks/)
assert.doesNotMatch(ready, /home-v2-pinned-apps__actions/)

const savedPins: DashboardPin[] = [
  { ...pins[0], id: 'current-null', accountId: null },
  { ...pins[0], id: 'current-missing' },
  { ...pins[0], id: 'guest', accountId: SAVED_GUEST_ACCOUNT_ID },
  { ...pins[0], id: 'saved', accountId: 'wallet:fixture' },
  { ...pins[0], id: 'derived', displayUrl: 'qortal://APP/Chat/default', accountId: 'wallet:fixture:1' },
  { ...pins[0], id: 'removed', accountId: 'wallet:removed' },
  { ...pins[1], id: 'home', accountId: 'wallet:removed' },
  { ...pins[1], id: 'core', displayUrl: 'qortal-core://admin/status', accountId: SAVED_GUEST_ACCOUNT_ID },
]
const account = (id: string, label: string): HomeV2AccountCatalogueEntry => ({
  id, label, walletId: 'fixture', address: 'QFixture', addressIndex: 0,
  isUnlocked: false, supportsDerivedAddresses: true,
})
const attributed = renderToStaticMarkup(<HomeV2PinnedApps {...callbacks}
  pins={savedPins} status="ready" accountCatalogue={{ activeAccountId: 'wallet:other', accounts: [
    account('wallet:fixture', 'Named account'), account('wallet:fixture:1', 'Derived <א> & 二'),
  ] }} />)
assert.equal((attributed.match(/class="home-v2-pinned-apps__account"/g) ?? []).length, 6)
assert.equal((attributed.match(/>Current<\/bdi>/g) ?? []).length, 2)
for (const label of ['No account', 'Named account', 'Derived &lt;א&gt; &amp; 二', 'Account unavailable']) {
  assert.ok(attributed.includes(`>${label}</bdi>`), label)
  assert.ok(attributed.includes(`title="Open Chat — ${label}"`), `full tooltip: ${label}`)
}
assert.doesNotMatch(attributed, /wallet:removed|wallet:other/)
const descriptions = [...attributed.matchAll(/aria-describedby="([^"]+)"/g)].map((match) => match[1])
assert.equal(new Set(descriptions).size, 6)
for (const id of descriptions) assert.ok(attributed.includes(`<bdi id="${id}"`))

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

// Discovery button: present only when the shell supplies a handler, so it is
// never a dead control, and it never hard-codes an app address.
const withDiscovery = renderToStaticMarkup(
  <HomeV2PinnedApps
    {...callbacks}
    onFindMoreApps={() => undefined}
    pins={pins}
    status="ready"
  />,
)
assert.match(withDiscovery, /home-v2-pinned-apps__find-button/)
assert.doesNotMatch(withDiscovery, /qdn:\/\/APP\/Explore/)
assert.doesNotMatch(ready, /home-v2-pinned-apps__find-button/)

// Pin icons load eagerly: a lazy image inside a hidden dashboard tab is never
// fetched, so the pins would show monograms until the tab is opened again.
const iconSource = readFileSync('src/v2/shell/HomeV2AppIcon.tsx', 'utf8')
assert.match(iconSource, /loading="eager"/)
assert.doesNotMatch(iconSource, /loading=\{[^}]*'lazy'/)

console.log('Home v2 pinned apps UI tests passed.')
