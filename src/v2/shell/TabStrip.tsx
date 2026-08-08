import type { TabId } from '../contracts'
import type { ProductState, ShellDestination } from '../product-model'
import { NetworkBadge, networkLabels } from './NetworkBadge'

export interface TabStripProps {
  readonly productState: ProductState
  readonly onActivateTab?: (tabId: TabId) => void
  readonly onCloseTab?: (tabId: TabId) => void
  readonly onNavigate?: (
    destination: Exclude<ShellDestination, 'tab'>,
  ) => void
}

export function TabStrip({
  productState,
  onActivateTab,
  onCloseTab,
  onNavigate,
}: TabStripProps) {
  return (
    <div className="home-v2-tabs" role="tablist" aria-label="Open apps">
      <div
        className={`home-v2-tab home-v2-tab--dashboard${
          productState.destination === 'dashboard' ? ' is-active' : ''
        }`}
      >
        <button
          type="button"
          role="tab"
          aria-selected={productState.destination === 'dashboard'}
          className={productState.destination === 'dashboard' ? 'is-active' : ''}
          onClick={() => onNavigate?.('dashboard')}
        >
          Dashboard
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
              <NetworkBadge network={tab.context.targetNetwork} />
            </button>
            <button
              type="button"
              className="home-v2-tab__close"
              aria-label={`Close ${tab.title} on ${networkLabels[tab.context.targetNetwork]}`}
              onClick={() => onCloseTab?.(tab.id)}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
