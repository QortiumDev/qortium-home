import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { ChevronDown, Compass, File, LayoutDashboard, Lock, Settings } from 'lucide-react'
import type { TabId } from '../contracts'
import type { ProductState, ShellEntry, TabPageId } from '../product-model'
import { t, type TranslationKey } from '../../i18n'
import { NetworkBadge, networkLabels } from './NetworkBadge'
import { HomeMark } from './ProductMarks'
import { HomeV2AppIcon } from './HomeV2AppIcon'
import type { VisibleAppIconLoader } from '../contracts'
import type {
  DualIdentityLookupResult,
  HomeV2AccountCatalogue,
  NetworkId,
  VisibleAvatarLoader,
} from '../contracts'
import { savedEntryAccountId } from './account-context'
import { VisibleIdentityAvatar } from './VisibleIdentityAvatar'
import { parseViewerLocation } from '../viewer-location'
import { groupTabsByAccount, groupedTabOrder, type TabGroup } from './tab-groups'

export interface TabStripProps {
  readonly productState: ProductState
  readonly accountCatalogue?: HomeV2AccountCatalogue
  readonly rememberedAccountLabels?: ReadonlyMap<string, string>
  readonly onActivateTab?: (tabId: TabId) => void
  readonly onCloseTab?: (tabId: TabId) => void
  readonly onReorderTab?: (tabId: TabId, toIndex: number) => void
  readonly onNewTab?: () => void
  /** Saves the tab as a toolbar bookmark when it is released over the strip. */
  readonly onDropOnBookmarkToolbar?: (tabId: TabId) => void | Promise<void>
  /** Moves the tab into its own window when it is dragged clear of the strip. */
  /**
   * Released clear of the strip. The SCREEN position travels with it: only the
   * main process can tell whether another Home window sits under that point,
   * and that decides whether the tab moves into that window or opens a new one.
   */
  readonly onDetachTab?: (
    tabId: TabId,
    position: { screenX: number; screenY: number },
  ) => void | Promise<void>
  /**
   * Right-click on a tab. The MENU is owned by the chrome, not by this strip,
   * because it has to register as an overlay: app pages are native views
   * composited over the renderer, so anything the shell draws sits BEHIND them
   * unless the view is suspended while it is open. That is the same defect the
   * node and account dropdowns had, and the same fix.
   */
  readonly onTabContextMenu?: (tabId: TabId, position: { x: number; y: number }) => void
  readonly newTabDisabled?: boolean
  readonly loadVisibleAppIcon?: VisibleAppIconLoader
  /**
   * Resolved identities for the accounts tabs are bound to, keyed by account
   * id. The chip needs one to show a published avatar: an account id alone
   * carries no avatar pointer, and only an identity lookup has it. Absent (or
   * missing an entry) the chip shows the initials it always did.
   */
  readonly accountIdentityLookups?: ReadonlyMap<string, DualIdentityLookupResult>
  readonly loadVisibleAvatar?: VisibleAvatarLoader
  /**
   * Opens the group picker (the chrome owns it, as an overlay). The badge
   * that asked reports where it is so the picker can sit under it.
   */
  readonly onOpenGroupPicker?: (position: { x: number; y: number }) => void
  /**
   * One group at a time -- the active tab's -- with the badge as the way to
   * the others. Decided by the strip's own width when absent.
   */
  readonly condensed?: boolean
  /** The selected account: the Dashboard tab sits in its group. */
  readonly selectedAccountId?: string | null
  /** Dragging a group's badge along the strip reorders the account groups. */
  readonly onReorderGroup?: (groupKey: string, toIndex: number) => void
  /** Dragging a group's badge clear of the strip moves the whole group out. */
  readonly onDetachGroup?: (
    groupKey: string,
    position: { screenX: number; screenY: number },
  ) => void | Promise<void>
}

/** Below this strip width only the active tab's group is shown. */
const CONDENSED_STRIP_WIDTH_PX = 600

export const internalTabLabelKeys: Readonly<Record<TabPageId, TranslationKey>> = {
  dashboard: 'common.dashboard',
  newtab: 'home2.tabs.newTab',
  settings: 'common.settings',
  // Short label: the full 'welcome.title' ("Welcome to Qortium Home") is the
  // page heading and is far too long for a tab.
  welcome: 'home2.tabs.welcome',
}

/**
 * Every internal page used to render the same Home mark, so a Dashboard tab
 * and a Settings tab were identical apart from their label.
 */
function InternalTabIcon({ page }: { readonly page: TabPageId }) {
  if (page === 'dashboard') return <HomeMark className="home-v2-tab__favicon" />
  const Icon = page === 'settings'
    ? Settings
    : page === 'welcome'
      ? Compass
      : LayoutDashboard
  return (
    <Icon
      className="home-v2-tab__favicon"
      aria-hidden="true"
      size={20}
      strokeWidth={2}
    />
  )
}

const TAB_DRAG_START_MIN_DISTANCE_PX = 5
/** Matches Home 1.x (TopBar.tsx:212): far enough that a detach is deliberate. */
const TAB_DRAG_OUT_MIN_DISTANCE_PX = 72

interface TabDragState {
  key: string
  pointerId: number
  startX: number
  startY: number
  hasReordered: boolean
}

/**
 * True when a drag was released over the bookmarks toolbar. Home 1.x hit-tested
 * the same way (`isToolbarDropRelease`, src/TopBar.tsx:1772) rather than using
 * HTML5 drag-and-drop, and checked it BEFORE any other release behaviour.
 */
function isBookmarkToolbarRelease(event: globalThis.PointerEvent): boolean {
  const toolbar = document.querySelector('.home-v2-bookmark-toolbar')
  if (!toolbar) return false
  const bounds = toolbar.getBoundingClientRect()
  if (bounds.width === 0 || bounds.height === 0) return false
  return (
    event.clientX >= bounds.left &&
    event.clientX <= bounds.right &&
    event.clientY >= bounds.top &&
    event.clientY <= bounds.bottom
  )
}

/**
 * True when a drag was released clear of the tab strip: outside the window
 * entirely, or far enough above/below the strip that it cannot be a reorder.
 * Ported from Home 1.x (`isDragOutRelease`, src/TopBar.tsx:1733).
 */
function isDetachRelease(
  event: globalThis.PointerEvent,
  drag: TabDragState,
  strip: HTMLElement | null,
): boolean {
  const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY)
  if (distance < TAB_DRAG_OUT_MIN_DISTANCE_PX) return false
  if (
    event.clientX < 0 ||
    event.clientX > window.innerWidth ||
    event.clientY < 0 ||
    event.clientY > window.innerHeight
  ) {
    return true
  }
  const bounds = strip?.getBoundingClientRect()
  if (!bounds) return false
  if (event.clientY < bounds.top) {
    return bounds.top - event.clientY >= TAB_DRAG_OUT_MIN_DISTANCE_PX
  }
  if (event.clientY > bounds.bottom) {
    return event.clientY - bounds.bottom >= TAB_DRAG_OUT_MIN_DISTANCE_PX
  }
  return false
}

function setBookmarkToolbarDropTarget(active: boolean) {
  const toolbar = document.querySelector('.home-v2-bookmark-toolbar')
  if (!toolbar) return
  if (active) toolbar.setAttribute('data-drop-target', 'true')
  else toolbar.removeAttribute('data-drop-target')
}

/**
 * Which chain a tab belongs to: its badge, and its account avatar, follow it.
 * Null for an internal page, which belongs to neither.
 */
function tabNetwork(entry: ShellEntry): NetworkId | null {
  if (entry.kind === 'app') return entry.context.sourceNetwork
  if (entry.kind === 'viewer') return parseViewerLocation(entry.location).network
  return null
}

function entryLabel(entry: ShellEntry): string {
  return entry.kind === 'internal'
    ? t(internalTabLabelKeys[entry.page])
    : entry.title
}

/**
 * The badge that heads a group: the Home mark for account-less tabs, the
 * account's avatar (or initials) plus its lock state otherwise. It is the one
 * place the account is shown -- the per-tab chip used to repeat it on every
 * tab -- and it opens the group picker.
 */
function TabGroupBadge({
  group,
  groupCount,
  condensed,
  accountCatalogue,
  rememberedAccountLabels,
  accountIdentityLookups,
  loadVisibleAvatar,
  onOpen,
  draggable = false,
  onPointerDown,
}: {
  readonly group: TabGroup
  readonly groupCount: number
  readonly condensed: boolean
  readonly accountCatalogue?: HomeV2AccountCatalogue
  readonly rememberedAccountLabels?: ReadonlyMap<string, string>
  readonly accountIdentityLookups?: ReadonlyMap<string, DualIdentityLookupResult>
  readonly loadVisibleAvatar?: VisibleAvatarLoader
  readonly onOpen?: (position: { x: number; y: number }) => void
  readonly draggable?: boolean
  readonly onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void
}) {
  const accountId = group.accountId
  const account = accountId
    ? accountCatalogue?.accounts.find((candidate) => candidate.id === accountId)
    : undefined
  const label = accountId
    ? account?.label ?? rememberedAccountLabels?.get(accountId) ?? t('home2.account.unavailableAccount')
    : t('address.suggestionHome')
  const locked = !!accountId && !account?.isUnlocked
  // The avatar follows the group's first tab's network: one account can have
  // published a different avatar on each chain.
  const network = accountId ? tabNetwork(group.entries[0]) : null
  const identity = accountId && network
    ? accountIdentityLookups?.get(accountId)?.networks[network]
    : undefined
  const initials = accountId ? label.slice(0, 2).toUpperCase() : ''
  // The accessible name is the account alone (the packaged detach smoke reads
  // it); the address and lock state ride on the tooltip.
  const name = accountId ? `${t('home2.account.tabAccount')}: ${label}` : label
  const title = [
    name,
    account ? account.address : null,
    locked ? t('account.statusLocked') : null,
  ].filter(Boolean).join(' · ')
  const openable = !!onOpen && (condensed || groupCount > 1)
  return (
    <button
      type="button"
      className="home-v2-tab-group__badge"
      data-tab-group-badge={group.key}
      data-locked={locked ? 'true' : 'false'}
      title={openable ? `${title} · ${t('home2.tabs.groups')}` : title}
      aria-label={name}
      aria-haspopup={openable ? 'menu' : undefined}
      data-draggable={draggable ? 'true' : 'false'}
      disabled={!openable && !draggable}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        if (!openable) return
        const bounds = event.currentTarget.getBoundingClientRect()
        onOpen?.({ x: bounds.left, y: bounds.bottom })
      }}
    >
      <span className="home-v2-tab-group__image">
        {!accountId ? (
          <HomeMark className="home-v2-tab-group__home" />
        ) : identity?.avatar && network && loadVisibleAvatar ? (
          <VisibleIdentityAvatar
            className="home-v2-tab-group__avatar"
            fallback={initials}
            identity={identity}
            loader={loadVisibleAvatar}
            network={network}
            query={identity.primaryName ?? label}
          />
        ) : (
          initials
        )}
      </span>
      {locked ? <Lock className="home-v2-tab-group__lock" size={10} aria-hidden="true" /> : null}
      {openable ? <ChevronDown className="home-v2-tab-group__chevron" size={12} aria-hidden="true" /> : null}
    </button>
  )
}

export function TabStrip({
  productState,
  accountCatalogue,
  rememberedAccountLabels,
  onActivateTab,
  onCloseTab,
  onReorderTab,
  onNewTab,
  onDropOnBookmarkToolbar,
  onDetachTab,
  onTabContextMenu,
  newTabDisabled,
  loadVisibleAppIcon,
  accountIdentityLookups,
  loadVisibleAvatar,
  onOpenGroupPicker,
  condensed,
  selectedAccountId,
  onReorderGroup,
  onDetachGroup,
}: TabStripProps) {
  const grouping = { dashboardAccountId: selectedAccountId ?? null }
  const tabElements = useRef(new Map<string, HTMLDivElement>())
  const stripRef = useRef<HTMLDivElement | null>(null)
  const dragState = useRef<TabDragState | null>(null)
  const detachDragListeners = useRef<(() => void) | null>(null)
  const suppressClickKey = useRef<string | null>(null)
  useEffect(() => () => detachDragListeners.current?.(), [])
  // Width-driven: a phone, or a narrow desktop window, shows one group.
  const [measuredCondensed, setMeasuredCondensed] = useState(false)
  useEffect(() => {
    const element = stripRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? element.clientWidth
      setMeasuredCondensed(width < CONDENSED_STRIP_WIDTH_PX)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const isCondensed = condensed ?? measuredCondensed
  const groups = groupTabsByAccount(productState.entries, grouping)
  const activeGroupKey = groups.find((group) =>
    group.entries.some((entry) => entry.id === productState.activeTabId))?.key ?? groups[0]?.key

  const orderedKeys = () => productState.entries.map((entry) => entry.id as string)

  const registerTab = (key: string) => (element: HTMLDivElement | null) => {
    if (element) tabElements.current.set(key, element)
    else tabElements.current.delete(key)
  }

  const handleDragMove = (event: globalThis.PointerEvent) => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (
      !drag.hasReordered &&
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <
        TAB_DRAG_START_MIN_DISTANCE_PX
    ) {
      return
    }
    // Live reorder WITHIN the tab's group. The strip is one flat, user-ordered
    // list underneath, but a tab dragged over another account's group would
    // read as moving it to that account -- a re-binding with permission
    // consequences, never a side effect of a drag -- so the candidates are
    // the group's own tabs and the drop lands at the nearest end of them.
    const flatKeys = orderedKeys()
    const fromIndex = flatKeys.indexOf(drag.key)
    if (fromIndex < 0 || flatKeys.length < 2) return
    const group = groupTabsByAccount(productState.entries, grouping)
      .find((candidate) => candidate.entries.some((entry) => entry.id === drag.key))
    const siblings = (group?.entries ?? [])
      .map((entry) => entry.id as string)
      .filter((key) => key !== drag.key)
    if (onDropOnBookmarkToolbar) {
      const overToolbar = isBookmarkToolbarRelease(event)
      setBookmarkToolbarDropTarget(overToolbar)
      // While the pointer is over the toolbar the gesture means "save this",
      // so it must not keep shuffling the strip underneath.
      if (overToolbar) return
    }
    if (siblings.length === 0) return
    let insertIndex = siblings.length
    for (const [index, key] of siblings.entries()) {
      const element = tabElements.current.get(key)
      if (!element) continue
      const bounds = element.getBoundingClientRect()
      if (event.clientX < bounds.left + bounds.width / 2) {
        insertIndex = index
        break
      }
    }
    // The reducer's index is a position in the flat list WITHOUT the dragged
    // tab: before the chosen sibling, or right after the group's last one.
    const flatWithout = flatKeys.filter((key) => key !== drag.key)
    const toIndex = insertIndex < siblings.length
      ? flatWithout.indexOf(siblings[insertIndex])
      : flatWithout.indexOf(siblings[siblings.length - 1]) + 1
    if (toIndex === fromIndex) return
    drag.hasReordered = true
    onReorderTab?.(drag.key as TabId, toIndex)
  }

  const handleDragEnd = (event: globalThis.PointerEvent) => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setBookmarkToolbarDropTarget(false)
    if (onDropOnBookmarkToolbar && isBookmarkToolbarRelease(event)) {
      // Releasing over the toolbar saves the tab; it must not also activate it.
      suppressClickKey.current = drag.key
      dragState.current = null
      detachDragListeners.current?.()
      void Promise.resolve(onDropOnBookmarkToolbar(drag.key as TabId)).catch(
        () => undefined,
      )
      return
    }
    // Checked after the toolbar drop, matching 1.x's ordering: dropping onto
    // the toolbar wins over detaching, since the toolbar sits below the strip
    // and would otherwise read as "dragged clear of it".
    if (onDetachTab && isDetachRelease(event, drag, stripRef.current)) {
      suppressClickKey.current = drag.key
      dragState.current = null
      detachDragListeners.current?.()
      void Promise.resolve(
        onDetachTab(drag.key as TabId, {
          screenX: event.screenX,
          screenY: event.screenY,
        }),
      ).catch(() => undefined)
      return
    }
    // A completed reorder must not also activate the tab the pointer landed
    // on; an ordinary press (no reorder) still clicks through normally.
    if (drag.hasReordered) suppressClickKey.current = drag.key
    dragState.current = null
    detachDragListeners.current?.()
  }

  const handlePointerDown = (
    event: PointerEvent<HTMLDivElement>,
    key: string,
  ) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // The close button must receive an ordinary click.
    if ((event.target as HTMLElement).closest('.home-v2-tab__close')) return
    if (!onReorderTab) return
    dragState.current = {
      key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      hasReordered: false,
    }
    // Deliberately NOT setPointerCapture: capturing on the tab makes Chromium
    // target the follow-up `click` at the capture element, so the inner
    // button[role=tab] never receives it and tabs stop switching entirely
    // (regression shipped in PR #351, fixed in #356).
    detachDragListeners.current?.()
    const onMove = (moveEvent: globalThis.PointerEvent) => handleDragMove(moveEvent)
    const onEnd = (endEvent: globalThis.PointerEvent) => handleDragEnd(endEvent)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    detachDragListeners.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      detachDragListeners.current = null
    }
  }

  // Dragging a badge: along the strip it reorders the account groups (the
  // Home group stays put); clear of the strip it moves the whole group out.
  // Kept apart from the tab drag so the two gestures cannot mix.
  const groupElements = useRef(new Map<string, HTMLDivElement>())
  const groupDrag = useRef<{
    key: string
    pointerId: number
    startX: number
    startY: number
    moved: boolean
  } | null>(null)
  const detachGroupDragListeners = useRef<(() => void) | null>(null)
  useEffect(() => () => detachGroupDragListeners.current?.(), [])
  const registerGroup = (key: string) => (element: HTMLDivElement | null) => {
    if (element) groupElements.current.set(key, element)
    else groupElements.current.delete(key)
  }
  const handleGroupDragMove = (event: globalThis.PointerEvent) => {
    const drag = groupDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (
      !drag.moved &&
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <
        TAB_DRAG_START_MIN_DISTANCE_PX
    ) {
      return
    }
    drag.moved = true
    if (!onReorderGroup) return
    const accountGroups = groups.filter((group) => group.accountId !== null)
    const fromIndex = accountGroups.findIndex((group) => group.key === drag.key)
    if (fromIndex < 0 || accountGroups.length < 2) return
    const siblings = accountGroups.filter((group) => group.key !== drag.key)
    let insertIndex = siblings.length
    for (const [index, group] of siblings.entries()) {
      const element = groupElements.current.get(group.key)
      if (!element) continue
      const bounds = element.getBoundingClientRect()
      if (event.clientX < bounds.left + bounds.width / 2) {
        insertIndex = index
        break
      }
    }
    if (insertIndex === fromIndex) return
    onReorderGroup(drag.key, insertIndex)
  }
  const handleGroupDragEnd = (event: globalThis.PointerEvent) => {
    const drag = groupDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    groupDrag.current = null
    detachGroupDragListeners.current?.()
    if (onDetachGroup && drag.moved && isDetachRelease(event, {
      key: drag.key, pointerId: drag.pointerId, startX: drag.startX, startY: drag.startY, hasReordered: false,
    }, stripRef.current)) {
      suppressClickKey.current = `group:${drag.key}`
      void Promise.resolve(
        onDetachGroup(drag.key, { screenX: event.screenX, screenY: event.screenY }),
      ).catch(() => undefined)
      return
    }
    // A drag, even one that changed nothing, is not a click on the picker.
    if (drag.moved) suppressClickKey.current = `group:${drag.key}`
  }
  const handleGroupPointerDown = (event: PointerEvent<HTMLButtonElement>, key: string) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (!onReorderGroup && !onDetachGroup) return
    groupDrag.current = {
      key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
    detachGroupDragListeners.current?.()
    const onMove = (moveEvent: globalThis.PointerEvent) => handleGroupDragMove(moveEvent)
    const onEnd = (endEvent: globalThis.PointerEvent) => handleGroupDragEnd(endEvent)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    detachGroupDragListeners.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      detachGroupDragListeners.current = null
    }
  }

  const consumeSuppressedClick = (key: string) => {
    if (suppressClickKey.current !== key) return false
    suppressClickKey.current = null
    return true
  }

  // Browser-style Left/Right (and Home/End) move focus between tab buttons —
  // focus only; Enter/Space still activates the focused tab.
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    key: string,
  ) => {
    const keys = groupedTabOrder(productState.entries, grouping)
    const currentIndex = keys.indexOf(key)
    if (currentIndex < 0) return
    let nextIndex: number | null = null
    if (event.key === 'ArrowLeft') nextIndex = Math.max(0, currentIndex - 1)
    else if (event.key === 'ArrowRight') {
      nextIndex = Math.min(keys.length - 1, currentIndex + 1)
    } else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = keys.length - 1
    if (nextIndex === null || nextIndex === currentIndex) return
    event.preventDefault()
    tabElements.current
      .get(keys[nextIndex])
      ?.querySelector<HTMLButtonElement>('button[role="tab"]')
      ?.focus()
  }

  const handleAuxClick = (
    event: MouseEvent<HTMLDivElement>,
    close: () => void,
  ) => {
    if (event.button !== 1) return
    event.preventDefault()
    close()
  }

  const renderTab = (entry: ShellEntry) => {
    const key = entry.id as string
    const isActive = productState.activeTabId === entry.id
    const label = entryLabel(entry)
    return (
      <div
        className={`home-v2-tab${
          entry.kind === 'internal' ? ' home-v2-tab--dashboard' : ''
        }${isActive ? ' is-active' : ''}`}
        key={key}
        data-tab-id={key}
        data-internal-page={entry.kind === 'internal' ? entry.page : undefined}
        ref={registerTab(key)}
        onPointerDown={(event) => handlePointerDown(event, key)}
        onAuxClick={(event) =>
          handleAuxClick(event, () => onCloseTab?.(entry.id))
        }
        onContextMenu={(event) => {
          if (!onTabContextMenu) return
          event.preventDefault()
          onTabContextMenu(entry.id, { x: event.clientX, y: event.clientY })
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={isActive}
          className={isActive ? 'is-active' : ''}
          onClick={() => {
            if (consumeSuppressedClick(key)) return
            onActivateTab?.(entry.id)
          }}
          onKeyDown={(event) => handleTabKeyDown(event, key)}
        >
          {entry.kind === 'internal' ? (
            <InternalTabIcon page={entry.page} />
          ) : entry.kind === 'viewer' ? (
            <File className="home-v2-tab__favicon" size={18} aria-hidden="true" />
          ) : (
            <HomeV2AppIcon
              displayUrl={entry.context.resourceLocation}
              loader={loadVisibleAppIcon}
              size={18}
              variant="tab"
            />
          )}
          <span>{label}</span>
          {entry.kind !== 'internal' ? (
            <NetworkBadge compact network={entry.kind === 'app' ? entry.context.sourceNetwork : parseViewerLocation(entry.location).network} />
          ) : null}
        </button>
        <button
          type="button"
          className="home-v2-tab__close"
          aria-label={
            entry.kind === 'app'
              ? t('home2.tabs.closeFrom', {
                  label,
                  network: networkLabels[entry.context.sourceNetwork],
                })
              : t('tabs.closeNamed', { label })
          }
          onClick={() => onCloseTab?.(entry.id)}
        >
          ×
        </button>
      </div>
    )
  }

  return (
    <div
      className="home-v2-tabs"
      data-condensed={isCondensed ? 'true' : 'false'}
      ref={stripRef}
      role="tablist"
      aria-label={t('tabs.listLabel')}
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget && !newTabDisabled) {
          onNewTab?.()
        }
      }}
    >
      {groups.map((group) => {
        if (isCondensed && group.key !== activeGroupKey) return null
        return (
          <div
            className="home-v2-tab-group"
            key={group.key}
            ref={registerGroup(group.key)}
            data-tab-group={group.key}
            data-active-group={group.key === activeGroupKey ? 'true' : 'false'}
          >
            {/* The Home group needs no marker beside its tabs: the divider
                separates it, and the Dashboard tab carries the Home mark.
                Condensed, its badge is the way to the other groups. */}
            {group.accountId !== null || isCondensed ? (
              <TabGroupBadge
                group={group}
                groupCount={groups.length}
                condensed={isCondensed}
                accountCatalogue={accountCatalogue}
                rememberedAccountLabels={rememberedAccountLabels}
                accountIdentityLookups={accountIdentityLookups}
                loadVisibleAvatar={loadVisibleAvatar}
                onOpen={(position) => {
                  if (consumeSuppressedClick(`group:${group.key}`)) return
                  onOpenGroupPicker?.(position)
                }}
                draggable={group.accountId !== null && !!(onReorderGroup || onDetachGroup)}
                onPointerDown={(event) => handleGroupPointerDown(event, group.key)}
              />
            ) : null}
            {group.entries.map((entry) => renderTab(entry))}
          </div>
        )
      })}
      <button
        type="button"
        className="home-v2-new-tab"
        aria-label={t('home2.tabs.newTab')}
        title={t('home2.tabs.newTab')}
        disabled={newTabDisabled}
        onClick={onNewTab}
      >
        +
      </button>
    </div>
  )
}
