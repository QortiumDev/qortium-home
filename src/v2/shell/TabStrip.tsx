import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { Compass, LayoutDashboard, Settings } from 'lucide-react'
import type { TabId } from '../contracts'
import type { ProductState, ShellEntry, TabPageId } from '../product-model'
import { t, type TranslationKey } from '../../i18n'
import { NetworkBadge, networkLabels } from './NetworkBadge'
import { HomeMark } from './ProductMarks'
import { HomeV2AppIcon } from './HomeV2AppIcon'
import type { VisibleAppIconLoader } from '../contracts'

export interface TabStripProps {
  readonly productState: ProductState
  readonly onActivateTab?: (tabId: TabId) => void
  readonly onCloseTab?: (tabId: TabId) => void
  readonly onReorderTab?: (tabId: TabId, toIndex: number) => void
  readonly onNewTab?: () => void
  /** Saves the tab as a toolbar bookmark when it is released over the strip. */
  readonly onDropOnBookmarkToolbar?: (tabId: TabId) => void | Promise<void>
  /** Moves the tab into its own window when it is dragged clear of the strip. */
  readonly onDetachTab?: (tabId: TabId) => void | Promise<void>
  readonly newTabDisabled?: boolean
  readonly loadVisibleAppIcon?: VisibleAppIconLoader
}

export const internalTabLabelKeys: Readonly<Record<TabPageId, TranslationKey>> = {
  dashboard: 'common.dashboard',
  newtab: 'home2.tabs.newTab',
  settings: 'common.settings',
  welcome: 'welcome.title',
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

function entryLabel(entry: ShellEntry): string {
  return entry.kind === 'internal'
    ? t(internalTabLabelKeys[entry.page])
    : entry.title
}

export function TabStrip({
  productState,
  onActivateTab,
  onCloseTab,
  onReorderTab,
  onNewTab,
  onDropOnBookmarkToolbar,
  onDetachTab,
  newTabDisabled,
  loadVisibleAppIcon,
}: TabStripProps) {
  const tabElements = useRef(new Map<string, HTMLDivElement>())
  const stripRef = useRef<HTMLDivElement | null>(null)
  const dragState = useRef<TabDragState | null>(null)
  const detachDragListeners = useRef<(() => void) | null>(null)
  const suppressClickKey = useRef<string | null>(null)
  useEffect(() => () => detachDragListeners.current?.(), [])

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
    // Live reorder across the whole strip: internal pages and app tabs are one
    // ordered list, so a tab can be dragged anywhere among its siblings.
    const keys = orderedKeys()
    const fromIndex = keys.indexOf(drag.key)
    if (fromIndex < 0 || keys.length < 2) return
    const siblings = keys.filter((key) => key !== drag.key)
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
    if (onDropOnBookmarkToolbar) {
      const overToolbar = isBookmarkToolbarRelease(event)
      setBookmarkToolbarDropTarget(overToolbar)
      // While the pointer is over the toolbar the gesture means "save this",
      // so it must not keep shuffling the strip underneath.
      if (overToolbar) return
    }
    if (insertIndex === fromIndex) return
    drag.hasReordered = true
    onReorderTab?.(drag.key as TabId, insertIndex)
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
      void Promise.resolve(onDetachTab(drag.key as TabId)).catch(() => undefined)
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
    const keys = orderedKeys()
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

  return (
    <div
      className="home-v2-tabs"
      ref={stripRef}
      role="tablist"
      aria-label={t('tabs.listLabel')}
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget && !newTabDisabled) {
          onNewTab?.()
        }
      }}
    >
      {productState.entries.map((entry) => {
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
              ) : (
                <HomeV2AppIcon
                  displayUrl={entry.context.resourceLocation}
                  loader={loadVisibleAppIcon}
                  size={18}
                  variant="tab"
                />
              )}
              <span>{label}</span>
              {entry.kind === 'app' ? (
                <NetworkBadge compact network={entry.context.sourceNetwork} />
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
