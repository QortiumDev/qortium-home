import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { HomeV2ContextMenu } from './HomeV2ContextMenu'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const container = document.createElement('div')
document.body.appendChild(container)
const root = createRoot(container)
const actions: string[] = []
let dismissals = 0

try {
  await act(async () => {
    root.render(
      <HomeV2ContextMenu
        items={[
          { action: 'resource.open-new-tab', group: 'open', label: 'Open in new tab' },
          { action: 'resource.copy-address', group: 'copy', label: 'Copy resource link' },
        ]}
        targetKind="resource"
        targetLabel="APP/Chat"
        onAction={(action) => actions.push(action)}
        onDismiss={() => { dismissals += 1 }}
      />,
    )
  })
  const menu = container.querySelector('[role="menu"]')
  assert(menu)
  const items = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  assert.deepEqual(items.map((item) => item.textContent?.trim()), [
    'Open in new tab',
    'Copy resource link',
  ])
  assert.equal(document.activeElement, items[0])
  await act(async () => items[1].click())
  assert.deepEqual(actions, ['resource.copy-address'])
  await act(async () => {
    menu.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
  })
  assert.equal(dismissals, 1)
} finally {
  await act(async () => root.unmount())
  container.remove()
}

console.log('Home v2 context menu interaction tests passed.')
