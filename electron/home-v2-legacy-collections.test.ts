import assert from 'node:assert/strict'
import { app, BrowserWindow, session } from 'electron'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  openHomeV2CollectionAddress,
  registerHomeV2CollectionsBridgeIpcHandlers,
  requestHomeV2Collections,
} from './home-v2-collections-bridge.js'
import { readHomeV2LegacyCollections } from './home-v2-legacy-collections.js'
import type { QdnViewContext } from './qdn-views.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const distDirectory = path.resolve(currentDirectory, '../dist')
const migrationUrl = pathToFileURL(path.join(distDirectory, 'collections-migration.html')).href
const legacyFixturePath = path.join(distDirectory, 'index-legacy-collections-test.html')
writeFileSync(legacyFixturePath, '<!doctype html><title>Legacy storage origin fixture</title>')

await app.whenReady()
registerHomeV2CollectionsBridgeIpcHandlers()
const seedWindow = new BrowserWindow({
  show: false,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    session: session.defaultSession,
  },
})
await seedWindow.loadFile(legacyFixturePath)
await seedWindow.webContents.executeJavaScript(`
    localStorage.clear();
    localStorage.setItem('qortium-home-bookmarks', JSON.stringify({
      bookmarks: [{
        accountId: 'account-1', createdAt: 1,
        displayUrl: 'qdn://APP/Boards/Boards', id: 'boards',
        title: 'Boards', type: 'bookmark'
      }],
      toolbar: [], toolbarVisibility: 'dashboard', version: 3
    }));
    localStorage.setItem('qortium-home-dashboard-pins', JSON.stringify([{
      createdAt: 2, displayUrl: 'qdn://APP/Help/Help',
      id: 'qdn://APP/Help/Help', label: 'Help'
    }]));
    localStorage.setItem('qortium-home-start-pages', JSON.stringify([{
      accountId: null, displayUrl: 'qdn://APP/Polls/Polls', title: 'Polls'
    }]));
    localStorage.setItem('qortium-home-bookmark-manager-revision', '7');
`)

const migrated = await readHomeV2LegacyCollections(distDirectory)
assert.equal(migrated.hadData, true)
assert.equal(migrated.snapshot.revision, 7)
assert.equal(migrated.snapshot.bookmarks[0]?.type, 'bookmark')
assert.equal(migrated.snapshot.dashboardPins[0]?.displayUrl, 'qdn://APP/Help/Help')
assert.equal(migrated.snapshot.startPages[0]?.displayUrl, 'qdn://APP/Polls/Polls')

const bridgeWindow = new BrowserWindow({
  show: false,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    preload: path.join(currentDirectory, 'home-v2-live-preload.cjs'),
    sandbox: true,
  },
})
await bridgeWindow.loadFile(legacyFixturePath)
await bridgeWindow.webContents.executeJavaScript(`
  window.homeV2Collections.onRequest((request) => {
    window.homeV2Collections.resolveRequest({
      requestId: request.id,
      result: {
        ...${JSON.stringify(migrated.snapshot)},
        activeAccountId: request.accountId,
        availableAccounts: [{ id: 'account-1', label: 'Main' }],
      },
    });
  });
  window.__openedCollectionAddress = new Promise((resolve) => {
    window.homeV2Collections.onOpen(resolve);
  });
  true;
`)
const bridgeContext = {
  accountId: 'account-1',
  tabId: 'bookmarks-tab',
  windowId: bridgeWindow.webContents.id,
} as unknown as QdnViewContext
const bridgedSnapshot = await requestHomeV2Collections(bridgeContext, 'get')
assert.equal((bridgedSnapshot as typeof migrated.snapshot).activeAccountId, 'account-1')
openHomeV2CollectionAddress(bridgeContext, {
  accountId: null,
  address: 'qdn://APP/Boards/Boards',
})
assert.deepEqual(
  await bridgeWindow.webContents.executeJavaScript('window.__openedCollectionAddress', true),
  {
    accountId: 'account-1',
    address: 'qdn://APP/Boards/Boards',
    sourceTabId: 'bookmarks-tab',
  },
)
bridgeWindow.destroy()

await seedWindow.webContents.executeJavaScript(`
  localStorage.removeItem('qortium-home-bookmark-manager-snapshot');
  localStorage.setItem('qortium-home-bookmarks', '{invalid');
`)
await seedWindow.loadURL(migrationUrl)
await assert.rejects(
  seedWindow.webContents.executeJavaScript('window.__QORTIUM_HOME_LEGACY_COLLECTIONS__', true),
  /could not be loaded safely/i,
)
seedWindow.destroy()
rmSync(legacyFixturePath)

console.log('Home 2 desktop legacy collections migration tests passed.')
