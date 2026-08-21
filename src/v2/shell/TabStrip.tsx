import type { TabId } from '../contracts'
import type { ProductState, ShellDestination } from '../product-model'
import { NetworkBadge, networkLabels } from './NetworkBadge'
import { HomeMark } from './ProductMarks'

export interface TabStripProps {
  readonly productState: ProductState
  readonly onActivateTab?: (tabId: TabId) => void
  readonly onCloseTab?: (tabId: TabId) => void
  readonly onNavigate?: (
    destination: Exclude<ShellDestination, 'tab'>,
  ) => void
  readonly onNewTab?: () => void
  readonly newTabDisabled?: boolean
}

const internalTabLabels: Readonly<
  Record<Exclude<ShellDestination, 'tab'>, string>
> = {
  activity: 'Activity',
  apps: 'Apps',
  dashboard: 'Dashboard',
  newtab: 'New tab',
  settings: 'Settings',
}

export function TabStrip({
  productState,
  onActivateTab,
  onCloseTab,
  onNavigate,
  onNewTab,
  newTabDisabled,
}: TabStripProps) {
  const internalDestination =
    productState.destination === 'tab' ? 'dashboard' : productState.destination
  const internalLabel = internalTabLabels[internalDestination]
  return (
    <div className="home-v2-tabs" role="tablist" aria-label="Browser tabs">
      <div
        className={`home-v2-tab home-v2-tab--dashboard${
          productState.destination !== 'tab' ? ' is-active' : ''
        }`}
      >
        <button
          type="button"
          role="tab"
          aria-selected={productState.destination !== 'tab'}
          className={productState.destination !== 'tab' ? 'is-active' : ''}
          onClick={() => onNavigate?.(internalDestination)}
        >
          <HomeMark className="home-v2-tab__favicon" />
          {internalLabel}
        </button>
      </div>
      {productState.tabs.map((tab) => {
        const isActive = productState.activeTabId === tab.id
        return (
          <div
            className={`home-v2-tab${isActive ? ' is-active' : ''}`}
            key={tab.id}
            data-tab-id={tab.id}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              className={isActive ? 'is-active' : ''}
              onClick={() => onActivateTab?.(tab.id)}
            >
              <span>{tab.title}</span>
              <NetworkBadge network={tab.context.sourceNetwork} />
            </button>
            <button
              type="button"
              className="home-v2-tab__close"
              aria-label={`Close ${tab.title} from ${networkLabels[tab.context.sourceNetwork]}`}
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
        aria-label="New tab"
        title="New tab"
        disabled={newTabDisabled}
        onClick={onNewTab}
      >
        +
      </button>
    </div>
  )
}
