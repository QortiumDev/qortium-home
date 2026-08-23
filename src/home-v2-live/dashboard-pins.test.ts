import assert from 'node:assert/strict'
import type { BookmarkManagerDashboardPin } from '../../electron/bookmark-manager-contract'
import {
  buildAdjacentDashboardPinMoveMutation,
  HOME_V2_DEFAULT_DASHBOARD_PIN_DRAFTS,
  shouldSeedHomeV2DefaultDashboardPins,
} from './dashboard-pins'

function pin(id: string): BookmarkManagerDashboardPin {
  return {
    createdAt: 1,
    displayUrl: `qdn://APP/${id}/${id}`,
    id,
    label: id,
  }
}

assert.deepEqual(HOME_V2_DEFAULT_DASHBOARD_PIN_DRAFTS, [
  { displayUrl: 'qdn://APP/Chat/Chat', title: 'Chat' },
  { displayUrl: 'qdn://APP/Help/Help', title: 'Help' },
])

assert.equal(
  shouldSeedHomeV2DefaultDashboardPins(true, []),
  true,
  'a genuinely fresh profile with no canonical pins receives the defaults',
)
assert.equal(
  shouldSeedHomeV2DefaultDashboardPins(false, []),
  false,
  'an existing or migrated profile that intentionally has no pins stays empty',
)
assert.equal(
  shouldSeedHomeV2DefaultDashboardPins(true, [pin('Existing')]),
  false,
  'canonical pins are never supplemented or replaced by defaults',
)

const pins = [pin('Chat'), pin('Help'), pin('Trust')]

assert.deepEqual(buildAdjacentDashboardPinMoveMutation(pins, 'Help', 'earlier'), {
  type: 'moveItem',
  itemId: 'Help',
  sourceRootId: 'pins',
  targetRootId: 'pins',
  targetItemId: 'Chat',
  targetPosition: 'before',
})
assert.deepEqual(buildAdjacentDashboardPinMoveMutation(pins, 'Help', 'later'), {
  type: 'moveItem',
  itemId: 'Help',
  sourceRootId: 'pins',
  targetRootId: 'pins',
  targetItemId: 'Trust',
  targetPosition: 'after',
})
assert.equal(buildAdjacentDashboardPinMoveMutation(pins, 'Chat', 'earlier'), null)
assert.equal(buildAdjacentDashboardPinMoveMutation(pins, 'Trust', 'later'), null)
assert.equal(buildAdjacentDashboardPinMoveMutation(pins, 'Missing', 'earlier'), null)

const concurrentlyReordered = [pin('Trust'), pin('Chat'), pin('Boards'), pin('Help')]
assert.deepEqual(
  buildAdjacentDashboardPinMoveMutation(concurrentlyReordered, 'Help', 'earlier'),
  {
    type: 'moveItem',
    itemId: 'Help',
    sourceRootId: 'pins',
    targetRootId: 'pins',
    targetItemId: 'Boards',
    targetPosition: 'before',
  },
  'a stale retry can recompute the adjacent target from the refreshed canonical order',
)

console.log('Home 2 dashboard pin helper tests passed.')
