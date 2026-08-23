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

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set
  assert(setter)
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

try {
  await act(async () => {
    root.render(
      <HomeV2PinnedApps
        pins={pins}
        status="ready"
        onAdd={(draft) => { actions.push(['add', draft]) }}
        onMove={(pinId, direction) => { actions.push(['move', pinId, direction]) }}
        onOpen={(pin) => { actions.push(['open', pin.id]) }}
        onRemove={(pin) => { actions.push(['remove', pin.id]) }}
        onRename={(pin, title) => { actions.push(['rename', pin.id, title]) }}
      />,
    )
  })

  await act(async () => button('Open Chat').click())
  assert.deepEqual(actions.at(-1), ['open', 'chat'])

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
  assert.equal(document.activeElement, button('Rename Help'))

  await act(async () => button('Back: Help').click())
  assert.deepEqual(actions.at(-1), ['move', 'help', 'earlier'])
  await act(async () => button('Remove Help').click())
  assert.deepEqual(actions.at(-1), ['remove', 'help'])
} finally {
  await act(async () => root.unmount())
  container.remove()
}

console.log('Home v2 pinned apps interaction tests passed.')
