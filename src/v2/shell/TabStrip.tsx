import {
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import type { TabId } from '../contracts'
import type {
  InternalPageId,
  ProductState,
  ShellDestination,
} from '../product-model'
import { t, type TranslationKey } from '../../i18n'
import { NetworkBadge, networkLabels } from './NetworkBadge'
import { HomeMark } from './ProductMarks'
import { HomeV2AppIcon } from './HomeV2AppIcon'
import type { VisibleAppIconLoader } from '../contracts'

export interface TabStripProps {
  readonly productState: ProductState
  readonly onActivateTab?: (tabId: TabId) => void
  readonly onCloseTab?: (tabId: TabId) => void
  readonly onCloseInternal?: (page: InternalPageId) => void
  readonly onReorderTab?: (tabId: TabId, toIndex: number) => void
  readonly onReorderInternal?: (page: InternalPageId, toIndex: number) => void
  readonly onNavigate?: (
    destination: Exclude<ShellDestination, 'tab'>,
  ) => void
  readonly onNewTab?: () => void
  readonly newTabDisabled?: boolean
  readonly loadVisibleAppIcon?: VisibleAppIconLoader
}

const internalTabLabelKeys: Readonly<
  Record<Exclude<ShellDestination, 'tab'>, TranslationKey>
> = {
  activity: 'home2.activity',
  apps: 'home2.apps',
  'core-docs': 'coreApi.title',
  dashboard: 'common.dashboard',
  newtab: 'home2.tabs.newTab',
  releases: 'releaseNotes.open',
  settings: 'common.settings',
  welcome: 'welcome.title',
}

const TAB_DRAG_START_MIN_DISTANCE_PX = 5

/** Tabs drag-reorder within their own group: internal pages stay grouped
 *  before app tabs. `key` is `internal:<page>` or the app tab id. */
type TabDragKind = 'app' | 'internal'

interface TabDragState {
  kind: TabDragKind
  key: string
  pointerId: number
  startX: number
  startY: number
  hasReordered: boolean
}

export function TabStrip({
  productState,
  onActivateTab,
  onCloseTab,
  onCloseInternal,
  onReorderTab,
  onReorderInternal,
  onNavigate,
  onNewTab,
  newTabDisabled,
  loadVisibleAppIcon,
}: TabStripProps) {
  const tabElements = useRef(new Map<string, HTMLDivElement>())
  const dragState = useRef<TabDragState | null>(null)
  const suppressClickKey = useRef<string | null>(null)

  const groupKeys = (kind: TabDragKind) =>
    kind === 'internal'
      ? productState.internalPages.map((page) => `internal:${page}`)
      : productState.tabs.map((tab) => tab.id as string)

  const dispatchReorder = (kind: TabDragKind, key: string, toIndex: number) => {
    if (kind === 'internal') {
      onReorderInternal?.(key.slice('internal:'.length) as InternalPageId, toIndex)
    } else {
      onReorderTab?.(key as TabId, toIndex)
    }
  }

  const registerTab = (key: string) => (element: HTMLDivElement | null) => {
    if (element) tabElements.current.set(key, element)
    else tabElements.current.delete(key)
  }

  const handlePointerDown = (
    event: PointerEvent<HTMLDivElement>,
    kind: TabDragKind,
    key: string,
  ) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // The close button must receive an ordinary click without pointer capture.
    if ((event.target as HTMLElement).closest('.home-v2-tab__close')) return
    if (kind === 'internal' ? !onReorderInternal : !onReorderTab) return
    dragState.current = {
      kind,
      key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      hasReordered: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (
      !drag.hasReordered &&
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <
        TAB_DRAG_START_MIN_DISTANCE_PX
    ) {
      return
    }
    // Live reorder: the tab's final index is where the pointer would insert
    // it among its group siblings (first sibling whose midpoint is right of
    // the pointer). The model no-ops when the index is unchanged.
    const keys = groupKeys(drag.kind)
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
    dispatchReorder(drag.kind, drag.key, insertIndex)
  }

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.hasReordered) suppressClickKey.current = drag.key
    dragState.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
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
    const keys = [...groupKeys('internal'), ...groupKeys('app')]
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
      {productState.internalPages.map((page) => {
        const isActive = productState.destination === page
        const label = t(internalTabLabelKeys[page])
        const key = `internal:${page}`
        return (
          <div
            className={`home-v2-tab home-v2-tab--dashboard${
              isActive ? ' is-active' : ''
            }`}
            key={key}
            data-internal-page={page}
            ref={registerTab(key)}
            onPointerDown={(event) => handlePointerDown(event, 'internal', key)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onAuxClick={(event) =>
              handleAuxClick(event, () => onCloseInternal?.(page))
            }
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              className={isActive ? 'is-active' : ''}
              onClick={() => {
                if (consumeSuppressedClick(key)) return
                onNavigate?.(page)
              }}
              onKeyDown={(event) => handleTabKeyDown(event, key)}
            >
              <HomeMark className="home-v2-tab__favicon" />
              {label}
            </button>
            <button
              type="button"
              className="home-v2-tab__close"
              aria-label={t('tabs.closeNamed', { label })}
              onClick={() => onCloseInternal?.(page)}
            >
              ×
            </button>
          </div>
        )
      })}
      {productState.tabs.map((tab) => {
        const isActive = productState.activeTabId === tab.id
        const key = tab.id as string
        return (
          <div
            className={`home-v2-tab${isActive ? ' is-active' : ''}`}
            key={key}
            data-tab-id={tab.id}
            ref={registerTab(key)}
            onPointerDown={(event) => handlePointerDown(event, 'app', key)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onAuxClick={(event) =>
              handleAuxClick(event, () => onCloseTab?.(tab.id))
            }
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              className={isActive ? 'is-active' : ''}
              onClick={() => {
                if (consumeSuppressedClick(key)) return
                onActivateTab?.(tab.id)
              }}
              onKeyDown={(event) => handleTabKeyDown(event, key)}
            >
              <HomeV2AppIcon
                displayUrl={tab.context.resourceLocation}
                loader={loadVisibleAppIcon}
                size={18}
                variant="tab"
              />
              <span>{tab.title}</span>
              <NetworkBadge network={tab.context.sourceNetwork} />
            </button>
            <button
              type="button"
              className="home-v2-tab__close"
              aria-label={t('home2.tabs.closeFrom', {
                label: tab.title,
                network: networkLabels[tab.context.sourceNetwork],
              })}
              onClick={() => onCloseTab?.(tab.id)}
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
