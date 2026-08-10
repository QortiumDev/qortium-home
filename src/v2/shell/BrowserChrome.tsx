import { useEffect, useState } from 'react'
import type { HomeV2Snapshot, NetworkId } from '../contracts'
import type { ProductState, ShellDestination } from '../product-model'
import { networkLabels } from './NetworkBadge'
import { HomeMark, NetworkMark } from './ProductMarks'
import { TabStrip } from './TabStrip'

export interface BrowserChromeProps {
  readonly snapshot: HomeV2Snapshot
  readonly productState: ProductState
  readonly onActivateTab?: (tabId: ProductState['tabs'][number]['id']) => void
  readonly onCloseTab?: (tabId: ProductState['tabs'][number]['id']) => void
  readonly onNavigate?: (
    destination: Exclude<ShellDestination, 'tab'>,
  ) => void
  readonly onOpenAddress?: (address: string) => string | null
  readonly canGoBack?: boolean
  readonly canGoForward?: boolean
  readonly onGoBack?: () => void
  readonly onGoForward?: () => void
  readonly onReload?: () => void
}

function nodeTone(snapshot: HomeV2Snapshot, network: NetworkId) {
  const node = snapshot.nodes[network]
  if (node.mode === 'disabled') return 'disabled'
  return node.state
}

function browserAddress(productState: ProductState): string {
  const activeTab = productState.tabs.find(
    (tab) => tab.id === productState.activeTabId,
  )
  if (activeTab) {
    return activeTab.context.resourceLocation
  }
  const destination =
    productState.destination === 'tab' ? 'dashboard' : productState.destination
  return `home://${destination}`
}

function accountLabel(snapshot: HomeV2Snapshot) {
  if (snapshot.account.state === 'none') return 'No account'
  if (snapshot.account.state === 'locked') {
    return `${snapshot.identity.displayLabel} · Locked`
  }
  return snapshot.identity.displayLabel
}

export function BrowserChrome({
  snapshot,
  productState,
  onActivateTab,
  onCloseTab,
  onNavigate,
  onOpenAddress,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onReload,
}: BrowserChromeProps) {
  const currentAddress = browserAddress(productState)
  const [address, setAddress] = useState(currentAddress)
  const [addressError, setAddressError] = useState<string | null>(null)
  useEffect(() => {
    setAddress(currentAddress)
    setAddressError(null)
  }, [currentAddress])
  const submitAddress = () => {
    if (!onOpenAddress) return
    setAddressError(onOpenAddress(address))
  }
  return (
    <header className="home-v2-browser-chrome">
      <div className="home-v2-browser-tabs-row">
        <div className="home-v2-window-brand" aria-label="Qortium Home 2.0">
          <HomeMark className="home-v2-window-brand__mark" />
          <strong>Qortium Home</strong>
        </div>
        <TabStrip
          productState={productState}
          onActivateTab={onActivateTab}
          onCloseTab={onCloseTab}
          onNavigate={onNavigate}
          onNewTab={() => onNavigate?.('dashboard')}
        />
      </div>
      <div className="home-v2-browser-toolbar">
        <div className="home-v2-browser-controls" aria-label="Page navigation">
          <button type="button" disabled={!canGoBack} aria-label="Back" title="Back" onClick={onGoBack}>
            ←
          </button>
          <button type="button" disabled={!canGoForward} aria-label="Forward" title="Forward" onClick={onGoForward}>
            →
          </button>
          <button type="button" aria-label="Reload" title="Reload" onClick={onReload}>
            ↻
          </button>
          <button
            type="button"
            aria-label="Dashboard"
            title="Dashboard"
            onClick={() => onNavigate?.('dashboard')}
          >
            ⌂
          </button>
        </div>
        <form
          className="home-v2-address"
          aria-label="Address and search"
          onSubmit={(event) => {
            event.preventDefault()
            submitAddress()
          }}
          data-error={addressError ? 'true' : 'false'}
        >
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Address and search"
            spellCheck={false}
            value={address}
            onChange={(event) => {
              setAddress(event.target.value)
              setAddressError(null)
            }}
          />
          <button type="submit" aria-label="Go to address" title="Go to address">
            Go
          </button>
          {addressError ? (
            <span className="home-v2-address__error" role="alert">
              {addressError}
            </span>
          ) : null}
        </form>
        <div className="home-v2-browser-actions">
          {(['qortal', 'qortium'] as const).map((network) => (
            <button
              key={network}
              type="button"
              className="home-v2-node-pill"
              data-node-tone={nodeTone(snapshot, network)}
              title={`${networkLabels[network]}: ${snapshot.nodes[network].statusText}`}
              onClick={() => onNavigate?.('dashboard')}
            >
              <NetworkMark network={network} />
              <span className="home-v2-status-dot" aria-hidden="true" />
              {networkLabels[network]}
            </button>
          ))}
          <button
            type="button"
            className="home-v2-toolbar-button"
            aria-label="Apps"
            title="Apps"
            onClick={() => onNavigate?.('apps')}
          >
            ◫
          </button>
          <button
            type="button"
            className="home-v2-toolbar-button"
            aria-label="Settings"
            title="Settings"
            onClick={() => onNavigate?.('settings')}
          >
            ⚙
          </button>
          <button
            type="button"
            className="home-v2-account-button"
            data-account-state={snapshot.account.state}
            onClick={() => onNavigate?.('dashboard')}
          >
            <span aria-hidden="true">
              {snapshot.account.state === 'none'
                ? '+'
                : snapshot.identity.displayLabel.slice(0, 1)}
            </span>
            {accountLabel(snapshot)}
          </button>
        </div>
      </div>
    </header>
  )
}
import { useEffect, useState } from 'react'
