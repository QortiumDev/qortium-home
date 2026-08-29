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

export type DashboardPinDropPosition = 'after' | 'before'

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

/**
 * What a brand-new profile finds on the bookmarks toolbar.
 *
 * Mirrors the dashboard pins above deliberately — the owner asked for "useful
 * things like chat and node", and a new profile arriving at an empty toolbar
 * with no idea what to put there is the reason this exists. Node is included
 * here but not on the dashboard, because the dashboard already has a whole
 * Node & Core section and the toolbar does not.
 */
export const HOME_V2_DEFAULT_TOOLBAR_LINK_DRAFTS = [
  {
    displayUrl: 'qdn://APP/Chat/Chat',
    title: 'Chat',
  },
  {
    displayUrl: 'qdn://APP/Node/Node',
    title: 'Node',
  },
] as const satisfies readonly BookmarkManagerLinkDraft[]

/**
 * Seed ONLY a genuinely fresh profile with an empty toolbar.
 *
 * Same rule as the dashboard pins: someone who cleared their toolbar on
 * purpose must not find it repopulated on the next launch, so an empty
 * toolbar alone is not enough — the profile has to be new.
 */
export function shouldSeedHomeV2DefaultToolbarLinks(
  isFreshProfile: boolean,
  toolbarItems: readonly unknown[],
): boolean {
  return isFreshProfile && toolbarItems.length === 0
}

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

  return buildDashboardPinMoveMutation(
    pinId,
    targetPin.id,
    direction === 'earlier' ? 'before' : 'after',
  )
}

export function buildDashboardPinMoveMutation(
  pinId: string,
  targetPinId: string,
  dropPosition: DashboardPinDropPosition,
): DashboardPinMoveMutation {
  return {
    type: 'moveItem',
    itemId: pinId,
    sourceRootId: 'pins',
    targetRootId: 'pins',
    targetItemId: targetPinId,
    targetPosition: dropPosition,
  }
}
