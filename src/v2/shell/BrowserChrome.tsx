import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { currentAppLocation } from '../current-app-location'
import type {
  DualIdentityLookupResult,
  HomeV2Snapshot,
  HomeV2AccountCatalogue,
  NetworkId,
  NodeConnectionMode,
  VisibleAppIconLoader,
  VisibleAvatarLoader,
} from '../contracts'
import {
  ArrowLeft,
  ArrowRight,
  PictureInPicture2,
  RotateCw,
  Settings,
} from 'lucide-react'
import { subscribeHomeV2MenuCommands } from '../menu-commands'
import type {
  ProductState,
  ShellDestination,
  TabPageId,
} from '../product-model'
import {
  DEFAULT_NEW_TAB_PREFERENCE,
  type NewTabPreference,
} from '../new-tab-preference'
import { HomeMark } from './ProductMarks'
import { internalTabLabelKeys, TabStrip } from './TabStrip'
import {
  HomeV2BookmarkToolbar,
  type HomeV2BookmarkToolbarProps,
} from './HomeV2BookmarkToolbar'
import { BookmarksMenuButton } from './BookmarksMenuButton'
import { AccountStatusMenu, NodeStatusMenu } from './ChromeStatusMenus'
import type { InlineUnlockSubmission } from './InlineAccountUnlock'
import type { HomeV2CoreManagement } from './CoreManagerCards'
import { locateBookmarkManagerLink } from '../../bookmarkManager'
import type { BookmarkToolbarVisibility } from '../../bookmarkToolbar'
import { chromeAccountContext, savedEntryAccountId } from './account-context'

export interface BrowserChromeProps {
  readonly snapshot: HomeV2Snapshot
  readonly accountCatalogue?: HomeV2AccountCatalogue
  readonly productState: ProductState
  readonly onActivateTab?: (tabId: ProductState['tabs'][number]['id']) => void
  readonly onCloseTab?: (tabId: ProductState['tabs'][number]['id']) => void
  /** Opens another instance of an internal page (the "+" / Ctrl+T route). */
  readonly onOpenInternalTab?: (page: TabPageId) => void
  readonly onReorderTab?: (
    tabId: ProductState['tabs'][number]['id'],
    toIndex: number,
  ) => void
  readonly onNavigate?: (
    destination: Exclude<ShellDestination, 'tab'>,
  ) => void
  readonly onOpenAddress?: (address: string) => Promise<AddressOpenResult>
  /**
   * Opens the named tab's app as a widget. Resolves to null on success, or to
   * a message to show when the app has no widget face or the grant was refused.
   */
  readonly onOpenAsWidget?: (tabId: string) => Promise<string | null>
  /**
   * Whether the active tab's app publishes a widget face. Undefined means the
   * host has not been told yet; the control stays hidden until it is, so it
   * never appears and then vanishes.
   */
  readonly widgetAvailable?: boolean
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
    'isDashboardRoute' | 'onOpenChange'
  >
  /** Saves or removes the address currently shown in the address bar. */
  readonly onToggleCurrentBookmark?: (draft: {
    readonly displayUrl: string
    readonly title: string
  }) => void | Promise<void>
  /** Opens the app that owns bookmark browsing and editing. */
  readonly onManageBookmarks?: () => void | Promise<void>
  readonly onSetBookmarkToolbarVisibility?: (
    visibility: BookmarkToolbarVisibility,
  ) => void | Promise<void>
  /** Saves a dragged tab onto the bookmarks toolbar. */
  readonly onDropTabOnBookmarkToolbar?: (
    tabId: ProductState['tabs'][number]['id'],
  ) => void | Promise<void>
  readonly onDetachTab?: (
    tabId: ProductState['tabs'][number]['id'],
  ) => void | Promise<void>
  /** Pins a tab's address to the dashboard, from the tab's context menu. */
  readonly onPinTabToDashboard?: (
    tabId: ProductState['tabs'][number]['id'],
  ) => void | Promise<void>
  readonly onLockAccount?: (accountId?: string) => void
  readonly onUnlockAccount?: (accountId: string | undefined, value: InlineUnlockSubmission) => Promise<void>
  readonly onOpenTabWithAccount?: (tabId: string, resourceLocation: string, accountId: string | null) => Promise<void>
  readonly rememberedUnlockAccountIds?: readonly string[]
  /**
   * Everything the node-status menus need to act rather than only report:
   * the Core manager and maintenance slices behind start/stop and updates,
   * plus the connection-mode writes the Dashboard's node card also makes.
   */
  readonly coreManagement?: HomeV2CoreManagement
  readonly onConfigureCustomNode?: (network: NetworkId) => void
  readonly onOpenCoreSettings?: () => void
  readonly onSetNodeMode?: (
    network: NetworkId,
    mode: NodeConnectionMode,
  ) => void | Promise<void>
  /**
   * True while any toolbar popover is showing — a menu, or the address bar's
   * result popup. App pages are native views composited over the renderer, so
   * nothing the chrome draws can sit on top of one; the shell answers this by
   * suspending the view (snapshot in its place) for as long as it is true.
   */
  readonly onOverlayOpenChange?: (open: boolean) => void
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
  if (activeTab && !productState.transient) {
    return currentAppLocation(activeTab)
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

/**
 * The title that belongs with browserAddress(), so a saved bookmark carries
 * the tab's name rather than its raw address.
 *
 * Pages that are not tabs (release notes, Core docs) have no title to offer,
 * and deliberately return EMPTY rather than the address: a bookmark whose
 * title is its own URL is indistinguishable from a real title downstream, and
 * the toolbar then renders an address instead of a name. Storing '' keeps the
 * "no title" signal honest so display code can derive a short label.
 */
function browserPageTitle(productState: ProductState): string {
  if (productState.transient) return ''
  const activeEntry = productState.entries.find(
    (entry) => entry.id === productState.activeTabId,
  )
  if (!activeEntry) return ''
  return activeEntry.kind === 'app'
    ? activeEntry.title
    : t(internalTabLabelKeys[activeEntry.page])
}

export function BrowserChrome({
  snapshot,
  accountCatalogue,
  productState,
  onActivateTab,
  onCloseTab,
  onOpenInternalTab,
  onReorderTab,
  onNavigate,
  onOpenAddress,
  onOpenAsWidget,
  widgetAvailable,
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
  onToggleCurrentBookmark,
  onManageBookmarks,
  onSetBookmarkToolbarVisibility,
  onDropTabOnBookmarkToolbar,
  onPinTabToDashboard,
  onDetachTab,
  onLockAccount,
  onUnlockAccount,
  onOpenTabWithAccount,
  rememberedUnlockAccountIds,
  coreManagement,
  onConfigureCustomNode,
  onOpenCoreSettings,
  onSetNodeMode,
  onOverlayOpenChange,
}: BrowserChromeProps) {
  // Retain only presentation labels after removal; authority always comes from
  // the current catalogue, so this cannot make a removed account unlockable.
  const rememberedAccountLabels = useRef(new Map<string, string>())
  for (const account of accountCatalogue?.accounts ?? []) {
    rememberedAccountLabels.current.set(account.id, account.label)
  }
  const activeEntry = productState.transient ? undefined : productState.entries.find((entry) => entry.id === productState.activeTabId)
  const accountTabLauncher = activeEntry?.kind === 'app' && activeEntry.context.previewUrl == null
    && !navigationDisabled && accountCatalogue && onOpenTabWithAccount
    ? { accountCatalogue, sourceAccountId: savedEntryAccountId(activeEntry), tabId: activeEntry.id,
        resourceLocation: activeEntry.context.resourceLocation, onOpenTabWithAccount }
    : undefined
  const accountContext = chromeAccountContext(
    snapshot,
    activeEntry,
    accountCatalogue,
    rememberedAccountLabels.current,
  )
  // Capture the identity actually displayed, even while a default-selection
  // catalogue update and its presentation snapshot are arriving separately.
  const unlockAccountId = accountContext.accountId ??
    accountContext.snapshot.account.selectedIdentityId?.replace(/^home-v2:identity:/, '')
  const currentAddress = browserAddress(
    productState,
    releaseNotesAddress,
    coreDocsAddress,
  )
  const bookmarkSnapshot = bookmarkToolbar?.snapshot ?? null
  const currentBookmark = bookmarkSnapshot
    ? locateBookmarkManagerLink(bookmarkSnapshot, currentAddress)
    : null
  const [address, setAddress] = useState(currentAddress)
  const addressEditing = useRef(false)
  const addressTab = useRef(productState.activeTabId)
  const [addressResult, setAddressResult] = useState<AddressOpenResult | null>(null)
  const [addressBusy, setAddressBusy] = useState(false)
  const [selectedChoice, setSelectedChoice] = useState('')
  const [widgetBusy, setWidgetBusy] = useState(false)
  const [widgetError, setWidgetError] = useState<string | null>(null)
  const [savedTabError, setSavedTabError] = useState<string | null>(null)
  const runSavedTabAction = async (action: () => void | Promise<void>) => {
    setSavedTabError(null)
    try { await action() } catch (error) {
      setSavedTabError(error instanceof Error ? error.message : String(error))
    }
  }
  const addressRequest = useRef(0)
  const addressInputRef = useRef<HTMLInputElement | null>(null)
  // Which toolbar popovers are open, by id. Several can coexist (a node menu
  // per network, the account menu, the bookmarks menu, the address result), so
  // the answer the shell needs is "any of them", not "the last one to change" —
  // this is Home 1.x's `overlayOpenById` registry (src/TopBar.tsx:2240).
  const [openOverlayIds, setOpenOverlayIds] = useState<readonly string[]>([])
  const setOverlayOpen = useCallback((overlayId: string, isOpen: boolean) => {
    setOpenOverlayIds((current) => {
      if (current.includes(overlayId) === isOpen) return current
      return isOpen
        ? [...current, overlayId]
        : current.filter((id) => id !== overlayId)
    })
  }, [])
  // The tab context menu. Its open state registers as an overlay for the same
  // reason every other popover here does: without suspending the app view, a
  // menu drawn by the shell renders BEHIND the page — which is exactly what
  // the tester saw ("right click on tabs shows behind app").
  const [tabMenu, setTabMenu] = useState<
    { tabId: ProductState['tabs'][number]['id']; x: number; y: number } | null
  >(null)
  useEffect(() => {
    setOverlayOpen('tab-context-menu', tabMenu !== null)
  }, [tabMenu, setOverlayOpen])
  const overlayOpen = openOverlayIds.length > 0
  const onOverlayOpenChangeRef = useRef(onOverlayOpenChange)
  useEffect(() => {
    onOverlayOpenChangeRef.current = onOverlayOpenChange
  }, [onOverlayOpenChange])
  // Keyed on the boolean, so closing one of two open menus reports nothing and
  // the app view stays suspended until the last one closes. The cleanup runs on
  // every true->false transition as well as on unmount, so a last-reported ref
  // dedupes it: the transition's cleanup and re-run collapse to one `false`,
  // while an unmount-while-open still releases the app view.
  const lastReportedOverlayOpenRef = useRef<boolean | null>(null)
  useEffect(() => {
    const report = (open: boolean) => {
      if (lastReportedOverlayOpenRef.current === open) return
      lastReportedOverlayOpenRef.current = open
      onOverlayOpenChangeRef.current?.(open)
    }
    report(overlayOpen)
    return () => {
      if (overlayOpen) report(false)
    }
  }, [overlayOpen])
  // The address bar's error/choose popup overhangs the page like the menus do,
  // and it is state rather than a popover component, so it registers here.
  useEffect(() => {
    setOverlayOpen('address-suggestions', addressResult !== null)
  }, [addressResult, setOverlayOpen])
  useEffect(() => {
    // Background SPA routing must not overwrite an address being typed.
    // Switching tabs still shows the newly selected tab's current URL.
    if (addressTab.current === productState.activeTabId && addressEditing.current) return
    addressTab.current = productState.activeTabId
    addressEditing.current = false
    addressRequest.current += 1
    setAddress(currentAddress)
    setAddressResult(null)
    setAddressBusy(false)
    setSelectedChoice('')
    setWidgetError(null)
  }, [currentAddress, productState.activeTabId])
  const submitAddress = async (requestedAddress = address) => {
    if (!onOpenAddress || navigationDisabled) return
    addressEditing.current = false
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
    if (newTabPreference.kind === 'custom') {
      setAddress(newTabPreference.address)
      void submitAddress(newTabPreference.address)
      return
    }
    // Always a NEW tab, even when that page is already open: "+" and Ctrl+T
    // are how duplicate instances are created.
    const page = newTabPreference.kind === 'dashboard' ? 'dashboard' : 'newtab'
    if (onOpenInternalTab) onOpenInternalTab(page)
    else onNavigate?.(page)
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
  // The page viewport sizes itself against the real chrome height via
  // --v2-chrome-height (text-size scaling and the bookmark toolbar both
  // change it), replacing the old hardcoded 98px/140px offsets.
  const chromeRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const element = chromeRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const shell = element.closest<HTMLElement>('.home-v2-shell')
    if (!shell) return
    const apply = () =>
      shell.style.setProperty(
        '--v2-chrome-height',
        `${Math.round(element.getBoundingClientRect().height)}px`,
      )
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(element)
    return () => {
      observer.disconnect()
      shell.style.removeProperty('--v2-chrome-height')
    }
  }, [])
  return (
    <header className="home-v2-browser-chrome" ref={chromeRef}>
      <div className="home-v2-browser-tabs-row">
        <TabStrip
          productState={productState}
          accountCatalogue={accountCatalogue}
          rememberedAccountLabels={rememberedAccountLabels.current}
          onActivateTab={onActivateTab}
          onCloseTab={onCloseTab}
          onReorderTab={onReorderTab}
          onNewTab={openNewTab}
          onDropOnBookmarkToolbar={onDropTabOnBookmarkToolbar ? (tabId) => runSavedTabAction(() => onDropTabOnBookmarkToolbar(tabId)) : undefined}
          onDetachTab={onDetachTab}
          onTabContextMenu={(tabId, position) =>
            setTabMenu({ tabId, x: position.x, y: position.y })}
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
            <ArrowLeft aria-hidden="true" size={18} strokeWidth={2} />
          </button>
          <button type="button" disabled={!canGoForward} aria-label={t('common.forward')} title={t('common.forward')} onClick={onGoForward}>
            <ArrowRight aria-hidden="true" size={18} strokeWidth={2} />
          </button>
          <button type="button" aria-label={t('home2.browser.reload')} title={t('home2.browser.reload')} onClick={onReload}>
            <RotateCw aria-hidden="true" size={18} strokeWidth={2} />
          </button>
          {onToggleCurrentBookmark ? (
            <BookmarksMenuButton
              isBookmarked={!!currentBookmark}
              disabled={navigationDisabled}
              onToggle={() => runSavedTabAction(() =>
                onToggleCurrentBookmark({
                  displayUrl: currentAddress,
                  title: browserPageTitle(productState),
                }))
              }
              onManage={onManageBookmarks}
              toolbarVisibility={bookmarkSnapshot?.toolbarVisibility}
              onSetToolbarVisibility={onSetBookmarkToolbarVisibility}
              onOpenChange={(open) => setOverlayOpen('bookmarks-menu', open)}
            />
          ) : null}
          <button
            type="button"
            className="home-v2-home-button"
            aria-label={t('common.dashboard')}
            title={t('common.dashboard')}
            onClick={() => onNavigate?.('dashboard')}
          >
            <HomeMark />
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
            onBlur={() => { addressEditing.current = false }}
            onChange={(event) => {
              addressEditing.current = true
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
          {(['qortium', 'qortal'] as const)
            .filter((network) => snapshot.nodes[network].mode !== 'disabled')
            .map((network) => (
            <NodeStatusMenu
              key={network}
              coreManagement={coreManagement}
              network={network}
              node={snapshot.nodes[network]}
              tone={nodeTone(snapshot, network)}
              onOpenChange={(open) =>
                setOverlayOpen(`node-menu:${network}`, open)
              }
              onConfigureCustomNode={onConfigureCustomNode}
              onOpenCoreSettings={onOpenCoreSettings}
              onSetNodeMode={onSetNodeMode}
            />
          ))}
          {onOpenAsWidget &&
          widgetAvailable === true &&
          productState.destination === 'tab' &&
          productState.activeTabId ? (
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
                // widgetAvailable already says the app publishes a widget, so
                // this reports the launch-time answers the probe deliberately
                // does not ask for: a refused grant, the one-widget-per-
                // resource limit, or a manifest that turns out to be broken.
                void onOpenAsWidget(tabId)
                  .then((message) => setWidgetError(message))
                  .finally(() => setWidgetBusy(false))
              }}
            >
              <PictureInPicture2 aria-hidden="true" size={18} strokeWidth={2} />
            </button>
          ) : null}
          <button
            type="button"
            className="home-v2-toolbar-button"
            aria-label={t('common.settings')}
            title={t('common.settings')}
            onClick={() => onNavigate?.('settings')}
          >
            <Settings aria-hidden="true" size={18} strokeWidth={2} />
          </button>
          <AccountStatusMenu
            key={`${productState.activeTabId}:${activeEntry?.kind === 'app' ? activeEntry.context.resourceLocation : ''}:${accountContext.snapshot.account.selectedIdentityId}:${accountContext.snapshot.account.state}:${accountContext.unavailable}`}
            accountTabLauncher={accountTabLauncher}
            snapshot={accountContext.snapshot}
            contextLabel={t(accountContext.tabBound ? 'home2.account.tabAccount' : 'home2.account.defaultAccount')}
            unavailable={accountContext.unavailable}
            selectedAccountLookup={accountContext.useSelectedLookup ? selectedAccountLookup : null}
            loadVisibleAvatar={loadVisibleAvatar}
            onLockAccount={onLockAccount && !accountContext.unavailable ? () => onLockAccount(accountContext.accountId ?? undefined) : undefined}
            onOpenChange={(open) => setOverlayOpen('account-menu', open)}
            rememberedUnlockAvailable={rememberedUnlockAccountIds?.includes(unlockAccountId ?? '')}
            onUnlockAccount={onUnlockAccount ? (value) => onUnlockAccount(unlockAccountId, value) : undefined}
          />
        </div>
      </div>
      {savedTabError ? (
        <div className="home-v2-saved-tab-error" role="alert">
          <span>{savedTabError}</span>
          <button type="button" aria-label={t('home2.common.close')} onClick={() => setSavedTabError(null)}>×</button>
        </div>
      ) : null}
      {bookmarkToolbar ? (
        <HomeV2BookmarkToolbar
          {...bookmarkToolbar}
          onOpenChange={(open) => setOverlayOpen('bookmark-toolbar', open)}
          keepEmptyStrip={!!onDropTabOnBookmarkToolbar}
          isDashboardRoute={
            productState.destination === 'dashboard' ||
            productState.destination === 'newtab'
          }
        />
      ) : null}
      {tabMenu ? (
        <>
          {/* A full-bleed backdrop so any click closes the menu, including a
              click on the page — the same shape the other popovers use. */}
          <div
            className="home-v2-tab-menu__backdrop"
            onClick={() => setTabMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault()
              setTabMenu(null)
            }}
          />
          <div
            className="home-v2-tab-menu"
            data-home-v2-tab-context-menu={String(tabMenu.tabId)}
            role="menu"
            style={{ left: tabMenu.x, top: tabMenu.y }}
          >
            {onPinTabToDashboard ? (
              <button
                autoFocus
                type="button"
                role="menuitem"
                data-home-v2-tab-menu-action="pin"
                onClick={() => {
                  void runSavedTabAction(() => onPinTabToDashboard(tabMenu.tabId))
                  setTabMenu(null)
                }}
              >
                {t('home2.tabs.pinToDashboard')}
              </button>
            ) : null}
            {onDropTabOnBookmarkToolbar ? (
              <button
                type="button"
                role="menuitem"
                data-home-v2-tab-menu-action="bookmark"
                onClick={() => {
                  void runSavedTabAction(() => onDropTabOnBookmarkToolbar(tabMenu.tabId))
                  setTabMenu(null)
                }}
              >
                {t('home2.tabs.addToBookmarks')}
              </button>
            ) : null}
            {onCloseTab ? (
              <button
                type="button"
                role="menuitem"
                data-home-v2-tab-menu-action="close"
                onClick={() => {
                  onCloseTab(tabMenu.tabId)
                  setTabMenu(null)
                }}
              >
                {t('tabs.closeTab')}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </header>
  )
}
