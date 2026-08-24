import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import type {
  DualIdentityLookupResult,
  HomeV2Snapshot,
  NetworkId,
  VisibleAppIconLoader,
  VisibleAvatarLoader,
} from '../contracts'
import { subscribeHomeV2MenuCommands } from '../menu-commands'
import type {
  InternalPageId,
  ProductState,
  ShellDestination,
} from '../product-model'
import {
  DEFAULT_NEW_TAB_PREFERENCE,
  type NewTabPreference,
} from '../new-tab-preference'
import { networkLabels } from './NetworkBadge'
import { NetworkMark } from './ProductMarks'
import { TabStrip } from './TabStrip'
import { VisibleIdentityAvatar } from './VisibleIdentityAvatar'
import {
  HomeV2BookmarkToolbar,
  type HomeV2BookmarkToolbarProps,
} from './HomeV2BookmarkToolbar'

export interface BrowserChromeProps {
  readonly snapshot: HomeV2Snapshot
  readonly productState: ProductState
  readonly onActivateTab?: (tabId: ProductState['tabs'][number]['id']) => void
  readonly onCloseTab?: (tabId: ProductState['tabs'][number]['id']) => void
  readonly onCloseInternal?: (page: InternalPageId) => void
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
  readonly releaseNotesAddress?: string
  readonly coreDocsAddress?: string
  readonly selectedAccountLookup?: DualIdentityLookupResult | null
  readonly loadVisibleAvatar?: VisibleAvatarLoader
  readonly loadVisibleAppIcon?: VisibleAppIconLoader
  readonly bookmarkToolbar?: Omit<
    HomeV2BookmarkToolbarProps,
    'isDashboardRoute'
  >
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

function browserAddress(
  productState: ProductState,
  releaseNotesAddress?: string,
  coreDocsAddress?: string,
): string {
  const activeTab = productState.tabs.find(
    (tab) => tab.id === productState.activeTabId,
  )
  if (activeTab) {
    return activeTab.context.resourceLocation
  }
  if (productState.destination === 'releases' && releaseNotesAddress) {
    return releaseNotesAddress
  }
  if (productState.destination === 'core-docs' && coreDocsAddress) {
    return coreDocsAddress
  }
  const destination =
    productState.destination === 'tab' ? 'dashboard' : productState.destination
  return `home://${destination}`
}

function accountLabel(snapshot: HomeV2Snapshot) {
  if (snapshot.account.state === 'none') return t('account.noAccount')
  if (snapshot.account.state === 'locked') {
    return `${snapshot.identity.displayLabel} · ${t('account.statusLocked')}`
  }
  return snapshot.identity.displayLabel
}

export function BrowserChrome({
  snapshot,
  productState,
  onActivateTab,
  onCloseTab,
  onCloseInternal,
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
  releaseNotesAddress,
  coreDocsAddress,
  selectedAccountLookup,
  loadVisibleAvatar,
  loadVisibleAppIcon,
  bookmarkToolbar,
}: BrowserChromeProps) {
  const currentAddress = browserAddress(
    productState,
    releaseNotesAddress,
    coreDocsAddress,
  )
  const [address, setAddress] = useState(currentAddress)
  const [addressResult, setAddressResult] = useState<AddressOpenResult | null>(null)
  const [addressBusy, setAddressBusy] = useState(false)
  const [selectedChoice, setSelectedChoice] = useState('')
  const [widgetBusy, setWidgetBusy] = useState(false)
  const [widgetError, setWidgetError] = useState<string | null>(null)
  const addressRequest = useRef(0)
  const addressInputRef = useRef<HTMLInputElement | null>(null)
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
        message:
          error instanceof Error
            ? error.message
            : t('home2.browser.openAddressFailed'),
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
  // Chrome-owned menu commands. The handler lives in a ref so the IPC
  // subscription mounts once while always seeing the current render's state.
  const menuCommandHandler = useRef<(command: string) => void>(() => {})
  menuCommandHandler.current = (command) => {
    if (command === 'new-tab') {
      openNewTab()
    } else if (command === 'focus-address-bar' && !navigationDisabled) {
      addressInputRef.current?.focus()
      addressInputRef.current?.select()
    }
  }
  useEffect(
    () =>
      subscribeHomeV2MenuCommands((command) =>
        menuCommandHandler.current(command),
      ),
    [],
  )
  // F6/Shift+F6 cycle focus between the tab strip, the address bar, and the
  // content region; Alt+D is the browser alias for focusing the address bar.
  // Region targets are looked up by their design-system classes inside this
  // shell root — the regions live in sibling components.
  const cycleRegionFocus = useRef<(forward: boolean) => void>(() => {})
  cycleRegionFocus.current = (forward) => {
    const root = addressInputRef.current?.closest('.home-v2-shell')
    if (!root) return
    const tabButton =
      root.querySelector<HTMLElement>(
        '.home-v2-tab > button[aria-selected="true"]',
      ) ?? root.querySelector<HTMLElement>('.home-v2-tab > button[role="tab"]')
    const address = navigationDisabled ? null : addressInputRef.current
    const content = root.querySelector<HTMLElement>(
      '.home-v2-app-stage--live, .home-v2-internal-page',
    )
    const regions = [tabButton, address, content].filter(
      (element): element is HTMLElement => !!element,
    )
    if (regions.length === 0) return
    const active = document.activeElement
    const currentIndex = regions.findIndex(
      (element) => element === active || element.contains(active),
    )
    const nextIndex =
      currentIndex < 0
        ? forward
          ? 0
          : regions.length - 1
        : (currentIndex + (forward ? 1 : -1) + regions.length) % regions.length
    regions[nextIndex].focus()
  }
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      const key = event.key.toLowerCase()
      if (
        key === 'd' &&
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        menuCommandHandler.current('focus-address-bar')
        event.preventDefault()
        return
      }
      if (key === 'f6' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        cycleRegionFocus.current(!event.shiftKey)
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])
  return (
    <header className="home-v2-browser-chrome">
      <div className="home-v2-browser-tabs-row">
        <TabStrip
          productState={productState}
          onActivateTab={onActivateTab}
          onCloseTab={onCloseTab}
          onCloseInternal={onCloseInternal}
          onNavigate={onNavigate}
          onNewTab={openNewTab}
          newTabDisabled={navigationDisabled}
          loadVisibleAppIcon={loadVisibleAppIcon}
        />
      </div>
      <div className="home-v2-browser-toolbar">
        <div
          className="home-v2-browser-controls"
          aria-label={t('home2.browser.pageNavigation')}
        >
          <button type="button" disabled={!canGoBack} aria-label={t('common.back')} title={t('common.back')} onClick={onGoBack}>
            ←
          </button>
          <button type="button" disabled={!canGoForward} aria-label={t('common.forward')} title={t('common.forward')} onClick={onGoForward}>
            →
          </button>
          <button type="button" aria-label={t('home2.browser.reload')} title={t('home2.browser.reload')} onClick={onReload}>
            ↻
          </button>
          <button
            type="button"
            aria-label={t('common.dashboard')}
            title={t('common.dashboard')}
            onClick={() => onNavigate?.('dashboard')}
          >
            ⌂
          </button>
        </div>
        <form
          className="home-v2-address"
          aria-label={t('home2.browser.addressAndSearch')}
          onSubmit={(event) => {
            event.preventDefault()
            void submitAddress()
          }}
          data-error={addressResult?.status === 'error' ? 'true' : 'false'}
        >
          <span aria-hidden="true">⌕</span>
          <input
            ref={addressInputRef}
            aria-label={t('home2.browser.addressAndSearch')}
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
            aria-label={t('home2.browser.goToAddress')}
            title={t('home2.browser.goToAddress')}
            disabled={navigationDisabled || addressBusy}
          >
            {addressBusy ? t('home2.browser.finding') : t('home2.browser.go')}
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
                  aria-label={t('home2.browser.appResourceIdentifier')}
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
                  {t('common.open')}
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
              aria-label={t('home2.browser.openAsWidget')}
              title={widgetError ?? t('home2.browser.openAsWidget')}
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
            aria-label={t('home2.apps')}
            title={t('home2.apps')}
            onClick={() => onNavigate?.('apps')}
          >
            ◫
          </button>
          <button
            type="button"
            className="home-v2-toolbar-button"
            aria-label={t('common.settings')}
            title={t('common.settings')}
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
            {snapshot.account.state === 'none' ? (
              <span aria-hidden="true">+</span>
            ) : selectedAccountLookup ? (
              <span className="home-v2-account-avatars" aria-hidden="true">
                {(['qortium', 'qortal'] as const)
                  .filter((network) => snapshot.nodes[network].mode !== 'disabled')
                  .map((network) => (
                    <VisibleIdentityAvatar
                      className="home-v2-account-avatar"
                      identity={selectedAccountLookup.networks[network]}
                      key={network}
                      loader={loadVisibleAvatar}
                      network={network}
                      query={selectedAccountLookup.query}
                    />
                  ))}
              </span>
            ) : (
              <span aria-hidden="true">
                {snapshot.identity.displayLabel.slice(0, 1)}
              </span>
            )}
            {accountLabel(snapshot)}
          </button>
        </div>
      </div>
      {bookmarkToolbar ? (
        <HomeV2BookmarkToolbar
          {...bookmarkToolbar}
          isDashboardRoute={
            productState.destination === 'dashboard' ||
            productState.destination === 'newtab'
          }
        />
      ) : null}
    </header>
  )
}
