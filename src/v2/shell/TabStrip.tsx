import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { Compass, LayoutDashboard, Rocket, Settings } from 'lucide-react'
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
  readonly newTabDisabled?: boolean
  readonly loadVisibleAppIcon?: VisibleAppIconLoader
}

const internalTabLabelKeys: Readonly<Record<TabPageId, TranslationKey>> = {
  activity: 'home2.activity',
  apps: 'home2.apps',
  dashboard: 'common.dashboard',
  newtab: 'home2.tabs.newTab',
  settings: 'common.settings',
}

/**
 * Every internal page used to render the same Home mark, so a Dashboard tab
 * and a Settings tab were identical apart from their label.
 */
function InternalTabIcon({ page }: { readonly page: TabPageId }) {
  if (page === 'dashboard') return <HomeMark className="home-v2-tab__favicon" />
  const Icon =
    page === 'settings'
      ? Settings
      : page === 'apps'
        ? Rocket
        : page === 'activity'
          ? Compass
          : LayoutDashboard
  return (
    <Icon
      className="home-v2-tab__favicon"
      aria-hidden="true"
      size={18}
      strokeWidth={1.9}
    />
  )
}

const TAB_DRAG_START_MIN_DISTANCE_PX = 5

interface TabDragState {
  key: string
  pointerId: number
  startX: number
  startY: number
  hasReordered: boolean
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
  newTabDisabled,
  loadVisibleAppIcon,
}: TabStripProps) {
  const tabElements = useRef(new Map<string, HTMLDivElement>())
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
    if (insertIndex === fromIndex) return
    drag.hasReordered = true
    onReorderTab?.(drag.key as TabId, insertIndex)
  }

  const handleDragEnd = (event: globalThis.PointerEvent) => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== event.pointerId) return
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
                <NetworkBadge network={entry.context.sourceNetwork} />
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
