import { useEffect, useRef, useState } from 'react'
import type { HomeV2Snapshot, NetworkId } from '../contracts'
import type { ProductState, ShellDestination } from '../product-model'
import {
  DEFAULT_NEW_TAB_PREFERENCE,
  type NewTabPreference,
} from '../new-tab-preference'
import { networkLabels } from './NetworkBadge'
import { NetworkMark } from './ProductMarks'
import { TabStrip } from './TabStrip'

export interface BrowserChromeProps {
  readonly snapshot: HomeV2Snapshot
  readonly productState: ProductState
  readonly onActivateTab?: (tabId: ProductState['tabs'][number]['id']) => void
  readonly onCloseTab?: (tabId: ProductState['tabs'][number]['id']) => void
  readonly onNavigate?: (
    destination: Exclude<ShellDestination, 'tab'>,
  ) => void
  readonly onOpenAddress?: (address: string) => Promise<AddressOpenResult>
  /**
   * Opens the named tab's app as a widget. Resolves to null on success, or to
   * a message to show when the app has no widget face or the grant was refused.
   */
  readonly onOpenAsWidget?: (tabId: string) => Promise<string | null>
  readonly canGoBack?: boolean
  readonly canGoForward?: boolean
  readonly onGoBack?: () => void
  readonly onGoForward?: () => void
  readonly onReload?: () => void
  readonly navigationDisabled?: boolean
  readonly newTabPreference?: NewTabPreference
}

export type AddressOpenResult =
  | { readonly status: 'opened' }
  | { readonly message: string; readonly status: 'error' }
  | {
      readonly message: string
      readonly options: readonly {
        readonly address: string
        readonly label: string
      }[]
      readonly status: 'choose'
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
  onOpenAsWidget,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onReload,
  navigationDisabled = false,
  newTabPreference = DEFAULT_NEW_TAB_PREFERENCE,
}: BrowserChromeProps) {
  const currentAddress = browserAddress(productState)
  const [address, setAddress] = useState(currentAddress)
  const [addressResult, setAddressResult] = useState<AddressOpenResult | null>(null)
  const [addressBusy, setAddressBusy] = useState(false)
  const [selectedChoice, setSelectedChoice] = useState('')
  const [widgetBusy, setWidgetBusy] = useState(false)
  const [widgetError, setWidgetError] = useState<string | null>(null)
  const addressRequest = useRef(0)
  useEffect(() => {
    addressRequest.current += 1
    setAddress(currentAddress)
    setAddressResult(null)
    setAddressBusy(false)
    setSelectedChoice('')
    setWidgetError(null)
  }, [currentAddress])
  const submitAddress = async (requestedAddress = address) => {
    if (!onOpenAddress || navigationDisabled) return
    const request = addressRequest.current + 1
    addressRequest.current = request
    setAddressBusy(true)
    setAddressResult(null)
    try {
      const result = await onOpenAddress(requestedAddress)
      if (addressRequest.current !== request) return
      setAddressResult(result.status === 'opened' ? null : result)
      setSelectedChoice(result.status === 'choose' ? result.options[0]?.address ?? '' : '')
    } catch (error) {
      if (addressRequest.current !== request) return
      setAddressResult({
        message: error instanceof Error ? error.message : 'Unable to open this address.',
        status: 'error',
      })
    } finally {
      if (addressRequest.current === request) setAddressBusy(false)
    }
  }
  const openNewTab = () => {
    if (navigationDisabled) return
    if (newTabPreference.kind === 'dashboard') {
      onNavigate?.('dashboard')
      return
    }
    if (newTabPreference.kind === 'custom') {
      setAddress(newTabPreference.address)
      void submitAddress(newTabPreference.address)
      return
    }
    onNavigate?.('newtab')
  }
  return (
    <header className="home-v2-browser-chrome">
      <div className="home-v2-browser-tabs-row">
        <TabStrip
          productState={productState}
          onActivateTab={onActivateTab}
          onCloseTab={onCloseTab}
          onNavigate={onNavigate}
          onNewTab={openNewTab}
          newTabDisabled={navigationDisabled}
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
            void submitAddress()
          }}
          data-error={addressResult?.status === 'error' ? 'true' : 'false'}
        >
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Address and search"
            disabled={navigationDisabled}
            spellCheck={false}
            value={address}
            onChange={(event) => {
              addressRequest.current += 1
              setAddress(event.target.value)
              setAddressResult(null)
              setAddressBusy(false)
              setSelectedChoice('')
            }}
          />
          <button
            type="submit"
            aria-label="Go to address"
            title="Go to address"
            disabled={navigationDisabled || addressBusy}
          >
            {addressBusy ? 'Finding…' : 'Go'}
          </button>
          {addressResult?.status === 'error' ? (
            <div className="home-v2-address__result" data-tone="error" role="alert">
              {addressResult.message}
            </div>
          ) : addressResult?.status === 'choose' ? (
            <div className="home-v2-address__result" data-tone="choice">
              <span>{addressResult.message}</span>
              <div className="home-v2-address__choice">
                <select
                  aria-label="App resource identifier"
                  disabled={navigationDisabled}
                  value={selectedChoice}
                  onChange={(event) => setSelectedChoice(event.target.value)}
                >
                  {addressResult.options.map((option) => (
                    <option key={option.address} value={option.address}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={navigationDisabled || !selectedChoice || addressBusy}
                  onClick={() => {
                    setAddress(selectedChoice)
                    void submitAddress(selectedChoice)
                  }}
                >
                  Open
                </button>
              </div>
            </div>
          ) : null}
        </form>
        <div className="home-v2-browser-actions">
          {(['qortium', 'qortal'] as const).map((network) => (
            <button
              key={network}
              type="button"
              className="home-v2-node-pill"
              data-network={network}
              data-node-tone={nodeTone(snapshot, network)}
              title={`${networkLabels[network]}: ${snapshot.nodes[network].statusText}`}
              onClick={() => onNavigate?.('dashboard')}
            >
              <NetworkMark network={network} />
              <span className="home-v2-status-dot" aria-hidden="true" />
              {networkLabels[network]}
            </button>
          ))}
          {onOpenAsWidget && productState.destination === 'tab' && productState.activeTabId ? (
            <button
              type="button"
              className="home-v2-toolbar-button"
              aria-label="Open as widget"
              title={widgetError ?? 'Open as widget'}
              data-tone={widgetError ? 'error' : undefined}
              disabled={widgetBusy}
              onClick={() => {
                const tabId = productState.activeTabId
                if (!tabId) return
                setWidgetBusy(true)
                setWidgetError(null)
                // Whether the app publishes a widget face is only knowable from
                // its manifest on the node, so the answer arrives here rather
                // than in the button's enabled state.
                void onOpenAsWidget(tabId)
                  .then((message) => setWidgetError(message))
                  .finally(() => setWidgetBusy(false))
              }}
            >
              ⧉
            </button>
          ) : null}
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
