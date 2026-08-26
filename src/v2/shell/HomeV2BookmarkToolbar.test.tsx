import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { BookmarkManagerSnapshot } from '../../bookmarkManagerContract'
import { homeV2Fixture } from '../test-kit/fixtures'
import { AppearanceSettingsPage } from './AppearanceSettingsPage'
import { HomeV2BookmarkToolbar } from './HomeV2BookmarkToolbar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const container = document.createElement('div')
document.body.appendChild(container)
const root = createRoot(container)
const opened: Array<{ accountId?: string | null; id: string }> = []
const contextActions: string[] = []

const link = {
  accountId: 'account-1',
  createdAt: 1,
  displayUrl: 'qdn://APP/Chat/Chat',
  id: 'chat',
  title: 'Chat',
  type: 'bookmark' as const,
}
const nestedLink = {
  accountId: null,
  createdAt: 3,
  displayUrl: 'qdn://APP/Help/Help',
  id: 'help',
  title: 'Help',
  type: 'bookmark' as const,
}
// Saved before the fix, when a missing title was persisted AS the address.
const urlTitledLink = {
  accountId: null,
  createdAt: 4,
  displayUrl: 'qdn://APP/Trust/Trust',
  id: 'trust',
  title: 'qdn://APP/Trust/Trust',
  type: 'bookmark' as const,
}
// Saved after the fix: no title at all.
const untitledLink = {
  accountId: null,
  createdAt: 5,
  displayUrl: 'qdn://APP/Minting/Minting',
  id: 'minting',
  title: '',
  type: 'bookmark' as const,
}
const snapshot: BookmarkManagerSnapshot = {
  activeAccountId: 'account-1',
  availableAccounts: [{ id: 'account-1', label: 'Main' }],
  bookmarks: [],
  dashboardPins: [],
  revision: 4,
  schemaVersion: 1,
  startPages: [],
  toolbar: [
    link,
    urlTitledLink,
    untitledLink,
    {
      children: [
        {
          children: [nestedLink],
          createdAt: 2,
          id: 'nested',
          title: 'Nested',
          type: 'folder',
        },
      ],
      createdAt: 2,
      id: 'tools',
      title: 'Tools',
      type: 'folder',
    },
  ],
  toolbarVisibility: 'always',
}

function renderToolbar(
  current: BookmarkManagerSnapshot | null,
  isDashboardRoute: boolean,
) {
  root.render(
    <HomeV2BookmarkToolbar
      getContextMenuItems={() => [
        { action: 'resource.open-new-tab', group: 'open', label: 'Open in new tab' },
        { action: 'resource.copy-address', group: 'copy', label: 'Copy resource link' },
      ]}
      isDashboardRoute={isDashboardRoute}
      onContextMenuAction={(_item, action) => {
        contextActions.push(action)
      }}
      onOpen={(item) => {
        opened.push({ accountId: item.accountId, id: item.id })
      }}
      snapshot={current}
    />,
  )
}

try {
  act(() => renderToolbar({ ...snapshot, toolbarVisibility: 'hidden' }, true))
  assert.equal(container.querySelector('.home-v2-bookmark-toolbar'), null)

  act(() => renderToolbar({ ...snapshot, toolbarVisibility: 'dashboard' }, false))
  assert.equal(container.querySelector('.home-v2-bookmark-toolbar'), null)

  act(() => renderToolbar({ ...snapshot, toolbarVisibility: 'dashboard' }, true))
  assert.ok(container.querySelector('.home-v2-bookmark-toolbar'))

  act(() => renderToolbar({ ...snapshot, toolbar: [] }, true))
  assert.equal(
    container.querySelector('.home-v2-bookmark-toolbar'),
    null,
    'an empty toolbar must not reserve a chrome row',
  )

  act(() => renderToolbar(snapshot, false))
  const linkButton = container.querySelector<HTMLButtonElement>(
    'button[data-bookmark-id="chat"]',
  )
  assert.ok(linkButton)
  assert.match(linkButton.textContent ?? '', /Main|M/)
  assert.match(linkButton.textContent ?? '', /Chat/)
  act(() => linkButton.click())
  assert.deepEqual(opened, [{ accountId: 'account-1', id: 'chat' }])

  // The label is the only unclassed span; the account chip and the app-icon
  // monogram are classed and would otherwise pollute textContent.
  const labelOf = (button: HTMLButtonElement) =>
    [...button.querySelectorAll('span')]
      .find((span) => !span.className)?.textContent?.trim() ?? ''

  assert.equal(labelOf(linkButton), 'Chat', 'a real title is shown as-is')

  // A stored title that is only the address is not a title: the strip shows the
  // derived short label and keeps the address as the tooltip.
  const urlTitledButton = container.querySelector<HTMLButtonElement>(
    'button[data-bookmark-id="trust"]',
  )
  assert.ok(urlTitledButton)
  assert.equal(labelOf(urlTitledButton), 'Trust')
  assert.equal(
    urlTitledButton.textContent?.includes('qdn://'),
    false,
    'a URL-shaped title must not be rendered as the label',
  )
  assert.equal(urlTitledButton.getAttribute('title'), 'qdn://APP/Trust/Trust')

  // An empty title derives the same way, and never renders blank.
  const untitledButton = container.querySelector<HTMLButtonElement>(
    'button[data-bookmark-id="minting"]',
  )
  assert.ok(untitledButton)
  assert.equal(labelOf(untitledButton), 'Minting')

  const folderButton = container.querySelector<HTMLButtonElement>(
    'button[data-bookmark-folder-id="tools"]',
  )
  assert.ok(folderButton)
  act(() => folderButton.click())
  assert.ok(container.querySelector('.home-v2-bookmark-toolbar__folder-menu'))
  assert.ok(container.querySelector('details[data-bookmark-folder-id="nested"]'))
  const nestedButton = container.querySelector<HTMLButtonElement>(
    'button[data-bookmark-id="help"]',
  )
  assert.ok(nestedButton)
  act(() => nestedButton.click())
  assert.deepEqual(opened.at(-1), { accountId: null, id: 'help' })

  act(() => {
    linkButton.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      clientX: 20,
      clientY: 30,
    }))
  })
  const copyButton = [...container.querySelectorAll<HTMLButtonElement>(
    '.home-v2-bookmark-toolbar__context-menu button',
  )].find((button) => button.textContent?.includes('Copy resource link'))
  assert.ok(copyButton)
  act(() => copyButton.click())
  assert.deepEqual(contextActions, ['resource.copy-address'])

  let selectedVisibility = ''
  act(() => {
    root.render(
      <AppearanceSettingsPage
        account={homeV2Fixture.account}
        appearance={homeV2Fixture.appearance}
        bookmarkToolbarVisibility="dashboard"
        onSetBookmarkToolbarVisibility={(visibility) => {
          selectedVisibility = visibility
        }}
        section="appearance"
      />,
    )
  })
  const visibilitySelect = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Bookmark Toolbar"]',
  )
  assert.ok(visibilitySelect)
  await act(async () => {
    visibilitySelect.value = 'always'
    visibilitySelect.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
  assert.equal(selectedVisibility, 'always')

  const css = readFileSync('src/v2/shell/home-v2-prototype.css', 'utf8')
  assert.match(
    css,
    /data-layout='phone'[\s\S]{0,180}home-v2-bookmark-toolbar/,
    'phone layout must retain a compact bookmark-toolbar rule',
  )
  assert.match(css, /home-v2-bookmark-toolbar__items[\s\S]{0,220}overflow-x:\s*auto/)
} finally {
  act(() => root.unmount())
  container.remove()
}

console.log('Home v2 bookmark toolbar tests passed.')
