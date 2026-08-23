import type {
  BookmarkManagerDashboardPin,
  BookmarkManagerLinkDraft,
  BookmarkManagerMutation,
} from '../../electron/bookmark-manager-contract'

export type DashboardPinMoveDirection = 'earlier' | 'later'

export type DashboardPinMoveMutation = Extract<
  BookmarkManagerMutation,
  { type: 'moveItem' }
>

export const HOME_V2_DEFAULT_DASHBOARD_PIN_DRAFTS = [
  {
    displayUrl: 'qdn://APP/Chat/Chat',
    title: 'Chat',
  },
  {
    displayUrl: 'qdn://APP/Help/Help',
    title: 'Help',
  },
] as const satisfies readonly BookmarkManagerLinkDraft[]

export function shouldSeedHomeV2DefaultDashboardPins(
  isFreshProfile: boolean,
  dashboardPins: readonly BookmarkManagerDashboardPin[],
): boolean {
  return isFreshProfile && dashboardPins.length === 0
}

export function buildAdjacentDashboardPinMoveMutation(
  dashboardPins: readonly BookmarkManagerDashboardPin[],
  pinId: string,
  direction: DashboardPinMoveDirection,
): DashboardPinMoveMutation | null {
  const currentIndex = dashboardPins.findIndex((pin) => pin.id === pinId)
  if (currentIndex < 0) return null

  const targetIndex = direction === 'earlier' ? currentIndex - 1 : currentIndex + 1
  const targetPin = dashboardPins[targetIndex]
  if (!targetPin) return null

  return {
    type: 'moveItem',
    itemId: pinId,
    sourceRootId: 'pins',
    targetRootId: 'pins',
    targetItemId: targetPin.id,
    targetPosition: direction === 'earlier' ? 'before' : 'after',
  }
}
