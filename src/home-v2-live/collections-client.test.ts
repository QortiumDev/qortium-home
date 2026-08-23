import assert from 'node:assert/strict'
import { HomeV2CollectionsClient } from './collections-client'
import {
  clearFakeCollectionPreferences,
  failNextFakeCollectionWrite,
  readFakeCollectionPreference,
  setFakeCollectionPreference,
} from './test-kit/fake-collections-preferences'
import { parseHomeV2LegacyCollectionsRaw } from './legacy-collections-contract'

Object.assign(globalThis, { window: {} })

const accounts = {
  activeAccountId: 'account-1',
  availableAccounts: [{ id: 'account-1', label: 'Main' }],
}

clearFakeCollectionPreferences()
setFakeCollectionPreference('qortium-home-bookmarks', JSON.stringify({
  bookmarks: [{
    accountId: 'account-1',
    createdAt: 1,
    displayUrl: 'qdn://APP/Boards/Boards',
    id: 'boards',
    title: 'Boards',
    type: 'bookmark',
  }],
  toolbar: [],
  toolbarVisibility: 'always',
  version: 3,
}))
setFakeCollectionPreference('qortium-home-dashboard-pins', JSON.stringify([{
  createdAt: 2,
  displayUrl: 'qdn://APP/Help/Help',
  id: 'qdn://APP/Help/Help',
  label: 'Help',
}]))
setFakeCollectionPreference('qortium-home-start-pages', JSON.stringify([{
  accountId: null,
  displayUrl: 'qdn://APP/Polls/Polls',
  title: 'Polls',
}]))
setFakeCollectionPreference('qortium-home-bookmark-manager-revision', '4')

const migratedClient = new HomeV2CollectionsClient()
const migrated = await migratedClient.getSnapshot(accounts)
assert.equal(migrated.revision, 4)
assert.equal(migrated.bookmarks[0]?.type, 'bookmark')
assert.equal(migrated.dashboardPins[0]?.displayUrl, 'qdn://APP/Help/Help')
assert.equal(migrated.startPages[0]?.displayUrl, 'qdn://APP/Polls/Polls')
assert.equal(migrated.activeAccountId, 'account-1')
assert.deepEqual(migrated.availableAccounts, accounts.availableAccounts)
assert.ok(readFakeCollectionPreference('qortium-home-bookmark-manager-snapshot'))

const applied = await migratedClient.apply({
  expectedRevision: 4,
  mutation: {
    page: { displayUrl: 'qdn://APP/Trust/Trust', title: 'Trust' },
    type: 'addStartPage',
  },
}, accounts)
assert.equal(applied.changed, true)
assert.equal(applied.snapshot.revision, 5)
assert.equal(applied.snapshot.startPages.at(-1)?.displayUrl, 'qdn://APP/Trust/Trust')

await assert.rejects(
  migratedClient.apply({
    expectedRevision: 4,
    mutation: { type: 'removeStartPage', displayUrl: 'qdn://APP/Trust/Trust' },
  }, accounts),
  (error: unknown) => (error as { code?: string }).code === 'HOME_DATA_STALE',
)

failNextFakeCollectionWrite('qortium-home-dashboard-pins')
await assert.rejects(
  migratedClient.apply({
    expectedRevision: 5,
    mutation: {
      pin: { displayUrl: 'qdn://APP/Chat/Chat', title: 'Chat' },
      type: 'addDashboardPin',
    },
  }, accounts),
  /Preferences write failed/,
)
assert.equal(
  JSON.parse(readFakeCollectionPreference('qortium-home-bookmark-manager-snapshot') ?? '{}').revision,
  5,
  'a failed mirror write must not advance the canonical CAS revision',
)
const retried = await migratedClient.apply({
  expectedRevision: 5,
  mutation: {
    pin: { displayUrl: 'qdn://APP/Chat/Chat', title: 'Chat' },
    type: 'addDashboardPin',
  },
}, accounts)
assert.equal(retried.snapshot.revision, 6)
assert.equal(retried.snapshot.dashboardPins.at(-1)?.displayUrl, 'qdn://APP/Chat/Chat')

const reloaded = await new HomeV2CollectionsClient().getSnapshot({
  activeAccountId: null,
  availableAccounts: [],
})
assert.equal(reloaded.revision, 6)
assert.equal(reloaded.activeAccountId, null)
assert.deepEqual(reloaded.availableAccounts, [])

setFakeCollectionPreference('qortium-home-bookmark-manager-snapshot', '{invalid')
await assert.rejects(
  new HomeV2CollectionsClient().getSnapshot(accounts),
  /could not be loaded safely/i,
)
assert.equal(readFakeCollectionPreference('qortium-home-bookmark-manager-snapshot'), '{invalid')

clearFakeCollectionPreferences()
setFakeCollectionPreference('qortium-home-bookmarks', '{invalid')
await assert.rejects(
  new HomeV2CollectionsClient().getSnapshot(accounts),
  /legacy saved Home links could not be loaded safely/i,
)
assert.equal(readFakeCollectionPreference('qortium-home-bookmark-manager-snapshot'), null)

const emptyRaw = {
  'qortium-home-bookmarks': null,
  'qortium-home-dashboard-pins': null,
  'qortium-home-start-pages': null,
  'qortium-home-bookmark-manager-revision': null,
  'qortium-home-bookmark-manager-snapshot': null,
} as const
assert.throws(
  () => parseHomeV2LegacyCollectionsRaw({
    ...emptyRaw,
    'qortium-home-bookmarks': '{}',
  }),
  /could not be loaded safely/i,
)
const disagreementCanonical = {
  bookmarks: [],
  dashboardPins: [],
  revision: 3,
  schemaVersion: 1,
  startPages: [],
  toolbar: [],
  toolbarVisibility: 'hidden',
}
assert.throws(
  () => parseHomeV2LegacyCollectionsRaw({
    ...emptyRaw,
    'qortium-home-bookmarks': JSON.stringify({
      bookmarks: [{
        createdAt: 1,
        displayUrl: 'qdn://APP/Boards/Boards',
        id: 'boards',
        title: 'Boards',
        type: 'bookmark',
      }],
      toolbar: [],
      toolbarVisibility: 'hidden',
      version: 3,
    }),
    'qortium-home-bookmark-manager-revision': '3',
    'qortium-home-bookmark-manager-snapshot': JSON.stringify(disagreementCanonical),
  }),
  /disagree at the same revision/i,
)
const historical = parseHomeV2LegacyCollectionsRaw({
  ...emptyRaw,
  'qortium-home-bookmarks': JSON.stringify({
    bookmarks: [{
      createdAt: 1,
      displayUrl: 'qdn://APP/Boards/Boards',
      id: 'historical-boards',
      title: 'Boards',
      type: 'bookmark',
    }],
    toolbar: [],
    toolbarVisible: true,
    version: 2,
  }),
  'qortium-home-bookmark-manager-revision': '2',
  'qortium-home-start-pages': JSON.stringify(['qdn://APP/Polls/Polls']),
})
assert.equal(historical.snapshot.toolbarVisibility, 'always')
assert.deepEqual(historical.snapshot.startPages, [{
  accountId: null,
  displayUrl: 'qdn://APP/Polls/Polls',
}])

console.log('Home 2 collections client tests passed.')
