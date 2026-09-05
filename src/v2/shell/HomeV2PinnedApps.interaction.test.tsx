import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { DashboardPin } from '../../dashboardPins'
import { HomeV2PinnedApps } from './HomeV2PinnedApps'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const pins: DashboardPin[] = [
  {
    createdAt: 1,
    displayUrl: 'qdn://APP/Chat/Chat',
    id: 'chat',
    label: 'Chat',
  },
  {
    createdAt: 2,
    displayUrl: 'qdn://APP/Help/Help',
    id: 'help',
    label: 'Help',
  },
]
const actions: unknown[] = []
const container = document.createElement('div')
document.body.appendChild(container)
const root = createRoot(container)

function button(label: string) {
  const found = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  )
  assert(found, `expected button labelled ${label}`)
  return found as HTMLButtonElement
}

function buttonText(label: string) {
  const found = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  assert(found, `expected button with text ${label}`)
  return found as HTMLButtonElement
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set
  assert(setter)
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function openMenu(label: string) {
  await act(async () => {
    button(label).dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        button: 2,
        cancelable: true,
        clientX: 120,
        clientY: 80,
      }),
    )
  })
  assert(container.querySelector('[role="menu"]'))
}

try {
  await act(async () => {
    root.render(
      <HomeV2PinnedApps
        pins={pins}
        status="ready"
        getContextMenuItems={() => [
          { action: 'resource.open-new-tab', group: 'open', label: 'Open in new tab' },
          { action: 'resource.copy-address', group: 'copy', label: 'Copy resource link' },
        ]}
        onAdd={(draft) => { actions.push(['add', draft]) }}
        onContextMenuAction={(pin, action) => { actions.push(['context', pin.id, action]) }}
        onMove={(pinId, direction) => { actions.push(['move', pinId, direction]) }}
        onReorder={(pinId, targetPinId, position) => {
          actions.push(['reorder', pinId, targetPinId, position])
        }}
        onOpen={(pin) => { actions.push(['open', pin.id]) }}
        onRemove={(pin) => { actions.push(['remove', pin.id]) }}
        onRename={(pin, title) => { actions.push(['rename', pin.id, title]) }}
      />,
    )
  })

  await act(async () => button('Open Chat').click())
  assert.deepEqual(actions.at(-1), ['open', 'chat'])

  await openMenu('Open Chat')
  await act(async () => buttonText('Open in new tab').click())
  assert.deepEqual(actions.at(-1), ['context', 'chat', 'resource.open-new-tab'])

  await act(async () => button('Create Pinned apps').click())
  const addInputs = [...container.querySelectorAll('.home-v2-pinned-apps__form input')]
  assert.equal(addInputs.length, 2)
  await act(async () => {
    setInputValue(addInputs[0] as HTMLInputElement, ' qdn://APP/Trust/Trust ')
    setInputValue(addInputs[1] as HTMLInputElement, ' My Trust ')
  })
  const addForm = container.querySelector('.home-v2-pinned-apps__form')
  assert(addForm)
  await act(async () => {
    addForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  assert.deepEqual(actions.at(-1), [
    'add',
    { displayUrl: 'qdn://APP/Trust/Trust', title: 'My Trust' },
  ])
  assert.equal(container.querySelector('.home-v2-pinned-apps__form'), null)
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
  assert.equal(document.activeElement, button('Create Pinned apps'))

  assert.equal(container.querySelector('[aria-label="Rename Help"]'), null)
  await openMenu('Open Help')
  await act(async () => button('Rename Help').click())
  const renameInput = container.querySelector('.home-v2-pinned-apps__rename input')
  assert(renameInput instanceof HTMLInputElement)
  await act(async () => setInputValue(renameInput, 'Support'))
  const renameForm = container.querySelector('.home-v2-pinned-apps__rename')
  assert(renameForm)
  await act(async () => {
    renameForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  assert.deepEqual(actions.at(-1), ['rename', 'help', 'Support'])
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
  assert.equal(document.activeElement, button('Open Help'))

  await openMenu('Open Help')
  await act(async () => button('Rename Help').click())
  const cancellableRename = container.querySelector('.home-v2-pinned-apps__rename')
  assert(cancellableRename)
  await act(async () => {
    cancellableRename.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    )
  })
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
  assert.equal(container.querySelector('.home-v2-pinned-apps__rename'), null)
  assert.equal(document.activeElement, button('Open Help'))

  await openMenu('Open Help')
  await act(async () => button('Back: Help').click())
  assert.deepEqual(actions.at(-1), ['move', 'help', 'earlier'])

  const helpButton = button('Open Help')
  helpButton.focus()
  await act(async () => {
    helpButton.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'F10',
        shiftKey: true,
      }),
    )
  })
  const keyboardMenu = container.querySelector('[role="menu"]')
  assert(keyboardMenu)
  await act(async () => {
    keyboardMenu.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    )
  })
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
  assert.equal(document.activeElement, helpButton)

  const list = container.querySelector('.home-v2-pinned-apps__grid') as HTMLUListElement & {
    hasPointerCapture: (pointerId: number) => boolean
    releasePointerCapture: (pointerId: number) => void
    setPointerCapture: (pointerId: number) => void
  }
  assert(list)
  let capturedPointerId: number | null = null
  list.setPointerCapture = (pointerId) => { capturedPointerId = pointerId }
  list.hasPointerCapture = (pointerId) => capturedPointerId === pointerId
  list.releasePointerCapture = () => { capturedPointerId = null }
  const chatCard = container.querySelector('[data-pin-id="chat"]') as HTMLLIElement
  const helpCard = container.querySelector('[data-pin-id="help"]') as HTMLLIElement
  assert(chatCard && helpCard)
  chatCard.getBoundingClientRect = () => ({
    bottom: 72,
    height: 72,
    left: 0,
    right: 72,
    top: 0,
    width: 72,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  helpCard.getBoundingClientRect = () => ({
    bottom: 72,
    height: 72,
    left: 82,
    right: 154,
    top: 0,
    width: 72,
    x: 82,
    y: 0,
    toJSON: () => ({}),
  })
  const actionCountBeforeDrag = actions.length
  await act(async () => {
    chatCard.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 7,
    }))
    list.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      button: 0,
      clientX: 145,
      clientY: 20,
      pointerId: 7,
    }))
    list.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      clientX: 145,
      clientY: 20,
      pointerId: 7,
    }))
    button('Open Chat').click()
  })
  assert.deepEqual(actions.at(-1), ['reorder', 'chat', 'help', 'after'])
  assert.equal(actions.length, actionCountBeforeDrag + 1)
  assert.equal(chatCard.style.transform, '', 'drag cleanup removes the inline transform')

  await new Promise((resolve) => window.setTimeout(resolve, 5))
  await act(async () => button('Open Chat').click())
  assert.deepEqual(actions.at(-1), ['open', 'chat'])

  const actionCountBeforeTap = actions.length
  await act(async () => {
    helpCard.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 100,
      clientY: 20,
      pointerId: 9,
    }))
    list.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      clientX: 100,
      clientY: 20,
      pointerId: 9,
    }))
    button('Open Help').click()
  })
  assert.equal(actions.length, actionCountBeforeTap + 1)
  assert.deepEqual(actions.at(-1), ['open', 'help'])

  await act(async () => {
    chatCard.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 8,
      pointerType: 'touch',
    }))
    await new Promise((resolve) => window.setTimeout(resolve, 525))
  })
  const longPressMenu = container.querySelector('[role="menu"]')
  assert(longPressMenu, 'a touch long press opens the pin menu')
  const actionCountAfterLongPress = actions.length
  await act(async () => {
    list.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 8,
      pointerType: 'touch',
    }))
    button('Open Chat').click()
  })
  assert.equal(
    actions.length,
    actionCountAfterLongPress,
    'the synthetic post-long-press click is suppressed',
  )
  await new Promise((resolve) => window.setTimeout(resolve, 5))
  await act(async () => button('Open Chat').click())
  assert.deepEqual(actions.at(-1), ['open', 'chat'])
  await act(async () => {
    longPressMenu.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    )
  })

  await openMenu('Open Help')
  await act(async () => button('Remove Help').click())
  assert.deepEqual(actions.at(-1), ['remove', 'help'])
} finally {
  await act(async () => root.unmount())
  container.remove()
}

// Grid width: balanced on the first paint, and unharmed by a dashboard tab
// being hidden — a display:none slot reports width 0 to the resize observer.
{
  type ObservedEntry = { readonly contentRect: { readonly width: number } }
  const priorGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
  const priorResizeObserver = globalThis.ResizeObserver
  const layoutContainer = document.createElement('div')
  document.body.appendChild(layoutContainer)
  const layoutRoot = createRoot(layoutContainer)
  let sectionWidth = 500
  let observed: ((entries: readonly ObservedEntry[]) => void) | null = null

  HTMLElement.prototype.getBoundingClientRect = () => ({
    bottom: 200,
    height: 200,
    left: 0,
    right: sectionWidth,
    top: 0,
    width: sectionWidth,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  globalThis.ResizeObserver = class {
    constructor(callback: (entries: readonly ObservedEntry[]) => void) {
      observed = callback
    }
    disconnect() {}
    observe() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver

  try {
    await act(async () => {
      layoutRoot.render(
        <HomeV2PinnedApps
          pins={pins}
          status="ready"
          onAdd={() => undefined}
          onMove={() => undefined}
          onOpen={() => undefined}
          onRemove={() => undefined}
          onRename={() => undefined}
          onReorder={() => undefined}
          onRetry={() => undefined}
        />,
      )
    })
    const grid = layoutContainer.querySelector(
      '.home-v2-pinned-apps__grid',
    ) as HTMLUListElement | null
    assert(grid)
    assert.equal(
      grid.style.maxWidth,
      '186px',
      'the first paint is measured synchronously, not left to the observer',
    )
    assert(observed, 'the section is observed for later resizes')

    await act(async () => {
      observed?.([{ contentRect: { width: 0 } }])
    })
    assert.equal(
      grid.style.maxWidth,
      '186px',
      'a hidden tab reporting width 0 keeps the last good measurement',
    )

    sectionWidth = 100
    await act(async () => {
      observed?.([{ contentRect: { width: 100 } }])
    })
    assert.equal(
      grid.style.maxWidth,
      '88px',
      'a real resize still re-balances the grid',
    )
  } finally {
    await act(async () => layoutRoot.unmount())
    layoutContainer.remove()
    HTMLElement.prototype.getBoundingClientRect = priorGetBoundingClientRect
    globalThis.ResizeObserver = priorResizeObserver
  }
}

// Catalogue updates change presentation only: saved pin identity and callbacks
// survive default changes, rename, lock state changes and account removal.
{
  const host = document.createElement('div')
  document.body.appendChild(host)
  const accountRoot = createRoot(host)
  const saved = { ...pins[0], accountId: 'wallet:fixture' }
  const opened: DashboardPin[] = []
  const render = async (label: string | null, activeAccountId: string | null, isUnlocked = false) => {
    await act(async () => accountRoot.render(<HomeV2PinnedApps pins={[saved]} status="ready"
      accountCatalogue={{ activeAccountId, accounts: label === null ? [] : [{
        id: saved.accountId, label, address: 'QFixture', addressIndex: 0,
        walletId: 'fixture', isUnlocked, supportsDerivedAddresses: true,
      }] }} onOpen={(pin) => { opened.push(pin) }}
      onAdd={() => undefined} onMove={() => undefined} onReorder={() => undefined}
      onRemove={() => undefined} onRename={() => undefined} />))
  }
  try {
    for (const [label, active, unlocked] of [
      ['Saved account', 'wallet:other', false], ['Renamed — 二', null, true],
      [null, 'wallet:other', false],
    ] as const) {
      await render(label, active, unlocked)
      const open = host.querySelector<HTMLButtonElement>('.home-v2-pinned-apps__open')!
      const description = host.querySelector('.home-v2-pinned-apps__account')!
      assert.equal(description.textContent, label ?? 'Account unavailable')
      assert.equal(open.getAttribute('aria-describedby'), description.id)
      assert.equal(open.disabled, false)
      await act(async () => open.click())
      assert.equal(opened.at(-1), saved, 'pass the original pin, never a rebound copy')
    }
  } finally {
    await act(async () => accountRoot.unmount())
    host.remove()
  }
}

console.log('Home v2 pinned apps interaction tests passed.')
