#!/usr/bin/env node

import assert from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  launchHome,
  waitUntil,
} from './lib/electron-main-driver.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const profileDirectory = mkdtempSync(
  path.join(os.tmpdir(), 'qortium-home-bookmark-toolbar-smoke-'),
)
const desktopScreenshot = path.join(
  os.tmpdir(),
  'qortium-home-v2-bookmark-toolbar.png',
)
const narrowScreenshot = path.join(
  os.tmpdir(),
  'qortium-home-v2-bookmark-toolbar-narrow.png',
)
let home = null
let renderer = null

const snapshot = {
  activeAccountId: 'account-1',
  availableAccounts: [{ id: 'account-1', label: 'Main account' }],
  bookmarks: [{ accountId: null, createdAt: 1, displayUrl: 'qdn://APP/Chat/Chat',
    id: 'chat-other-copy', title: 'Other Chat bookmark', type: 'bookmark' }],
  dashboardPins: [],
  revision: 9,
  schemaVersion: 1,
  startPages: [],
  toolbar: [
    {
      accountId: 'account-1',
      createdAt: 1,
      displayUrl: 'qdn://APP/Chat/Chat',
      id: 'chat',
      title: 'Chat',
      type: 'bookmark',
    },
    {
      children: [
        {
          accountId: null,
          createdAt: 3,
          displayUrl: 'qdn://APP/Help/Help',
          id: 'help',
          title: 'Help',
          type: 'bookmark',
        },
        {
          children: [
            {
              accountId: null,
              createdAt: 5,
              displayUrl: 'qdn://APP/Trust/Trust',
              id: 'trust',
              title: 'Trust',
              type: 'bookmark',
            },
          ],
          createdAt: 4,
          id: 'community',
          title: 'Community',
          type: 'folder',
        },
      ],
      createdAt: 2,
      id: 'qdn-apps',
      title: 'QDN apps',
      type: 'folder',
    },
  ],
  toolbarVisibility: 'always',
}

try {
  writeFileSync(
    path.join(profileDirectory, 'home-v2-shell-state.json'),
    JSON.stringify({
      version: 3,
      appearance: {
        accent: 'clay',
        appZoom: 100,
        language: 'system',
        textSize: 'medium',
        theme: 'dark',
      },
      newTabPreference: { kind: 'search' },
      onboarding: { currentStep: 'finish', status: 'skipped', version: 1 },
      selectedAccountId: null,
      selectedAddressId: null,
      product: { activeTabId: null, destination: 'dashboard', tabs: [] },
    }),
    { mode: 0o600 },
  )

  home = await launchHome({ profileDirectory, repoRoot })
  renderer = await home.renderer(
    (url) => url.includes('/v2-live.html'),
    'Home 2 bookmark toolbar',
  )
  await renderer.send('Runtime.enable')
  await renderer.send('Page.enable')
  await renderer.evaluate(`localStorage.setItem(
    'qortium-home-bookmark-manager-snapshot',
    ${JSON.stringify(JSON.stringify(snapshot))}
  )`)
  await renderer.send('Page.reload', { ignoreCache: true })

  await waitUntil('the bookmark toolbar to render', 60_000, () =>
    renderer.evaluate(`document.querySelectorAll(
      '.home-v2-bookmark-toolbar > .home-v2-bookmark-toolbar__items > .home-v2-bookmark-toolbar__item'
    ).length === 2`))
  assert.equal(
    await renderer.evaluate(`document.querySelector(
      '.home-v2-bookmark-toolbar'
    )?.getAttribute('data-toolbar-visibility')`),
    'always',
  )
  assert.match(
    await renderer.evaluate(`document.querySelector(
      '[data-bookmark-id="chat"]'
    )?.textContent ?? ''`),
    /Chat/,
  )
  await renderer.evaluate(`document.querySelector(
    '[data-bookmark-folder-id="qdn-apps"]'
  )?.click()`)
  await waitUntil('the nested folder menu to render', 10_000, () =>
    renderer.evaluate(`!!document.querySelector(
      '.home-v2-bookmark-toolbar__folder-menu [data-bookmark-id="trust"]'
    )`))

  const desktop = await renderer.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(desktopScreenshot, desktop.data, 'base64')

  await renderer.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    key: 'Escape',
  }))`)
  await renderer.send('Emulation.setDeviceMetricsOverride', {
    deviceScaleFactor: 1,
    height: 820,
    mobile: false,
    width: 430,
  })
  await waitUntil('the narrow Home layout', 10_000, () =>
    renderer.evaluate(`window.innerWidth <= 430`))
  const narrowState = await renderer.evaluate(`(() => {
    const toolbar = document.querySelector('.home-v2-bookmark-toolbar')
    const items = document.querySelector('.home-v2-bookmark-toolbar__items')
    return {
      overflow: items ? getComputedStyle(items).overflowX : null,
      visible: !!toolbar && toolbar.getBoundingClientRect().height > 0,
    }
  })()`)
  assert.equal(narrowState.visible, true)
  assert.equal(narrowState.overflow, 'auto')

  const narrow = await renderer.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(narrowScreenshot, narrow.data, 'base64')

  const removeLink = async (id) => {
    await renderer.evaluate(`document.querySelector('[data-bookmark-id="${id}"]').dispatchEvent(
      new MouseEvent('contextmenu', {bubbles:true, clientX:30, clientY:100}))`)
    await waitUntil('Remove from Bookmarks menu item', 10_000, () => renderer.evaluate(
      `!!document.querySelector('[data-bookmark-action="remove"]')`))
    if (id === 'chat') {
      const menu = await renderer.send('Page.captureScreenshot', {format:'png'})
      writeFileSync(path.join(os.tmpdir(), 'qortium-home-v2-bookmark-remove.png'), menu.data, 'base64')
    }
    await renderer.evaluate(`document.querySelector('[data-bookmark-action="remove"]').click()`)
    await waitUntil('bookmark removed from the toolbar', 10_000, () => renderer.evaluate(
      `!document.querySelector('[data-bookmark-id="${id}"]')`))
  }
  await removeLink('chat')
  await renderer.evaluate(`document.querySelector('[data-bookmark-folder-id="qdn-apps"]').click()`)
  await renderer.evaluate(`document.querySelector('.home-v2-bookmark-toolbar__nested-folder > summary').click()`)
  await removeLink('trust')
  const saved = await renderer.evaluate(`JSON.parse(localStorage.getItem('qortium-home-bookmark-manager-snapshot'))`)
  assert.equal(saved.toolbar.length, 1, 'only the selected top-level bookmark is removed')
  assert.equal(saved.toolbar[0].id, 'qdn-apps')
  assert.equal(saved.toolbar[0].children[0].id, 'help', 'the sibling bookmark survives')
  assert.deepEqual(saved.toolbar[0].children[1].children, [], 'only the selected nested link is removed')
  assert.equal(saved.bookmarks[0].id, 'chat-other-copy', 'the same address in another collection survives')
  await renderer.send('Page.reload', {ignoreCache:true})
  await waitUntil('persisted toolbar after reload', 10_000, () => renderer.evaluate(
    `!!document.querySelector('[data-bookmark-folder-id="qdn-apps"]')`))
  assert.equal(await renderer.evaluate(`!!document.querySelector('[data-bookmark-id="chat"]')`), false)
  console.log('Toolbar removal persisted across reload; nested siblings and other copies preserved.')
  console.log(`Home 2 bookmark toolbar smoke passed: ${desktopScreenshot}, ${narrowScreenshot}`)
} finally {
  renderer?.close()
  home?.main.close()
  await home?.stop()
  rmSync(profileDirectory, { force: true, maxRetries: 5, recursive: true })
}
