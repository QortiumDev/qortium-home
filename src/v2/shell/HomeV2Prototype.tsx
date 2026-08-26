import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { t } from '../../i18n'
import { translateMainProcessMessage } from '../../mainProcessMessage'
import {
  isHomeV2RtlLanguage,
  stepHomeV2TextSize,
  type HomeV2Accent,
  type HomeV2Language,
  type HomeV2TextSize,
  type HomeV2UiStyle,
  type HomeV2ThemePreference,
} from '../appearance'
import type {
  AppDescriptor,
  DualIdentityLookupResult,
  HomeV2AccountCatalogue,
  HomeV2Snapshot,
  HomeV2VaultState,
  NetworkId,
  NodeConnectionMode,
  TabId,
  VisibleAppIconLoader,
  VisibleAvatarLoader,
} from '../contracts'
import { subscribeHomeV2MenuCommands } from '../menu-commands'
import {
  hasHomeV2NativeZoom,
  setHomeV2WindowZoom,
  stepHomeV2WindowZoom,
} from '../zoom-client'
import type {
  PermissionDecision,
  PermissionRequestId,
  PermissionState,
} from '../bridge-permissions'
import type {
  ProductState,
  ShellDestination,
  TabPageId,
} from '../product-model'
import type { NewTabPreference } from '../new-tab-preference'
import { useHomeV2Translation } from '../i18n'
import {
  AppTabStage,
  type AppTabNavigationController,
  type AppTabNavigationSnapshot,
} from './AppTabStage'
import { BrowserChrome, type AddressOpenResult } from './BrowserChrome'
import { NetworkBadge } from './NetworkBadge'
import { PermissionDialog } from './PermissionDialog'
import { VisibleIdentityAvatar } from './VisibleIdentityAvatar'
import {
  SettingsPage,
  type HomeV2SettingsSectionTarget,
} from './SettingsPage'
import type { HomeV2CoreManagement } from './CoreManagerCards'
import { HomeV2NodeCoreSection } from './HomeV2NodeCoreSection'
import type {
  HomeV2AppBridgeProtocol,
  HomeV2AppRequestContext,
  HomeV2NodeClient,
} from '../../home-v2-live/node-client'
import type { HomeV2AppUpdates } from '../../home-v2-live/app-update-controller'
import type { HomeV2MaintenanceControllers } from '../../home-v2-live/maintenance-controllers'
import type { HomeV2QdnSettingsManagement } from '../../home-v2-live/qdn-settings-client'
import type { HomeV2NotificationPolicyState } from '../../home-v2-live/notification-policy-client'
import type {
  HomeV2WindowBehaviorChange,
  HomeV2WindowBehaviorState,
} from '../../home-v2-live/window-behavior-client'
import type { HomeV2OnChainCoreUpdates } from '../../home-v2-live/on-chain-core-update-controller'
import {
  HomeV2ReleaseNotesPage,
  type HomeV2ReleaseNotesTarget,
} from './HomeV2ReleaseNotesPage'
import type {
  HomeV2OnboardingState,
  HomeV2OnboardingStep,
} from '../../home-v2-live/onboarding-state'
import { HomeV2WelcomePage } from './HomeV2WelcomePage'
import { HomeV2CoreApiDocsPage } from './HomeV2CoreApiDocsPage'
import type { HomeV2CoreDocsTransport } from '../../home-v2-live/core-docs-client'
import {
  HomeV2PinnedApps,
  type HomeV2PinnedAppsProps,
} from './HomeV2PinnedApps'
import type { HomeV2BookmarkToolbarProps } from './HomeV2BookmarkToolbar'
import type { BookmarkToolbarVisibility } from '../../bookmarkToolbar'
import './home-v2-prototype.css'

export type HomeV2Layout = 'desktop' | 'phone'
export type HomeV2AccountSelection = 'none' | 'current' | 'create' | 'import' | 'private' | `account:${string}`
export type HomeV2AccountManageAction =
  | 'add-address'
  | 'export'
  | 'import-private-key'
  | 'remove-account'
  | 'remove-address'
  | 'rename'

export interface HomeV2PrototypeProps {
  readonly snapshot: HomeV2Snapshot
  readonly productState: ProductState
  readonly permissionState: PermissionState
  readonly layout: HomeV2Layout
  readonly surfaceNotice?: string
  readonly overlay?: ReactNode
  readonly appOverlayTabId?: ProductState['tabs'][number]['id'] | null
  readonly identityLookup?: DualIdentityLookupResult | null
  readonly identityLookupBusy?: boolean
  readonly identityLookupError?: string | null
  readonly identityLookupInput?: string
  readonly newTabPreference?: NewTabPreference
  readonly loadVisibleAvatar?: VisibleAvatarLoader
  readonly loadVisibleAppIcon?: VisibleAppIconLoader
  readonly accountCatalogue?: HomeV2AccountCatalogue
  readonly vaultState?: HomeV2VaultState
  readonly selectedAccountId?: string | null
  readonly appReloadVersion?: number
  readonly selectedAccountLookup?: DualIdentityLookupResult | null
  readonly nodeClient?: HomeV2NodeClient | null
  readonly coreManagement?: HomeV2CoreManagement
  // The app's one set of maintenance controllers, for the Settings and Welcome
  // panels that render more of each domain than the dashboard tile's slice.
  readonly maintenance?: HomeV2MaintenanceControllers
  readonly appUpdates?: HomeV2AppUpdates
  readonly onChainCoreUpdates?: HomeV2OnChainCoreUpdates
  readonly qdnAppsManagement?: HomeV2QdnSettingsManagement
  /** Current Home-profile manager revisions, seeded into each shown app view. */
  // Structural twin of electron/qdn-manager-events' QdnManagerRevisions —
  // the renderer may not import from electron/ (escape-hatch scan).
  readonly managerRevisions?: {
    readonly bookmarkManager: number
    readonly notificationManager: number
  } | null
  readonly resolveAccountLabel?: (accountId: string) => string | null
  readonly notificationPolicy?: HomeV2NotificationPolicyState | null
  readonly windowBehavior?: HomeV2WindowBehaviorState | null
  readonly releaseNotesTarget?: HomeV2ReleaseNotesTarget | null
  readonly onboarding?: HomeV2OnboardingState
  readonly pinnedApps?: HomeV2PinnedAppsProps
  readonly bookmarkToolbar?: Omit<
    HomeV2BookmarkToolbarProps,
    'isDashboardRoute'
  >
  readonly bookmarkToolbarVisibility?: BookmarkToolbarVisibility
  readonly onToggleCurrentBookmark?: (draft: {
    readonly displayUrl: string
    readonly title: string
  }) => void | Promise<void>
  readonly onManageBookmarks?: () => void | Promise<void>
  readonly onDropTabOnBookmarkToolbar?: (tabId: TabId) => void | Promise<void>
  readonly onDetachTab?: (tabId: TabId) => void | Promise<void>
  readonly coreDocsNetwork?: NetworkId | null
  readonly coreDocsTransport?: HomeV2CoreDocsTransport
  readonly enableCoreDocs?: (network: NetworkId) => Promise<unknown>
  readonly probeCoreDocs?: (
    network: NetworkId,
    nodeApiUrl: string,
  ) => Promise<{ status: number }>
  readonly requestApp?: (
    protocol: HomeV2AppBridgeProtocol,
    request: unknown,
    context: HomeV2AppRequestContext,
  ) => Promise<unknown>
  readonly onOpenApp?: (app: AppDescriptor) => void
  readonly onOpenAddress?: (address: string) => Promise<AddressOpenResult>
  /**
   * OPEN_CURRENT_TAB: replace one app tab's content in place. Reaches only the
   * app stage — the address bar always opens a tab of its own.
   */
  readonly onOpenAddressInTab?: (
    address: string,
    tabId: string,
    fromResourceLocation: string,
  ) => Promise<AddressOpenResult>
  readonly onOpenAsWidget?: (tabId: string) => Promise<string | null>
  /** Undefined while the host is still asking main whether the app has one. */
  readonly widgetAvailable?: boolean
  readonly onAppNavigationChanged?: (
    tabId: ProductState['tabs'][number]['id'],
    snapshot: AppTabNavigationSnapshot,
  ) => void
  readonly onAppNavigationControllerChange?: (
    tabId: ProductState['tabs'][number]['id'],
    controller: AppTabNavigationController | null,
  ) => void
  readonly onAppTitleChanged?: (
    tabId: ProductState['tabs'][number]['id'],
    title: string | null,
  ) => void
  readonly canGoBack?: boolean
  readonly canGoForward?: boolean
  readonly onGoBack?: () => void
  readonly onGoForward?: () => void
  readonly onReload?: () => void
  readonly onActivateTab?: (tabId: ProductState['tabs'][number]['id']) => void
  readonly onCloseTab?: (tabId: ProductState['tabs'][number]['id']) => void
  readonly onOpenInternalTab?: (page: TabPageId) => void
  readonly onReorderTab?: (
    tabId: ProductState['tabs'][number]['id'],
    toIndex: number,
  ) => void
  readonly onNavigate?: (
    destination: Exclude<ShellDestination, 'tab'>,
  ) => void
  readonly onResolvePermission?: (
    requestId: PermissionRequestId,
    decision: PermissionDecision,
  ) => void
  readonly onSetNodeMode?: (
    network: NetworkId,
    mode: NodeConnectionMode,
  ) => void | Promise<void>
  readonly onRefreshNode?: (network: NetworkId) => void
  readonly onConfigureCustomNode?: (network: NetworkId) => void
  readonly onIdentityLookupInput?: (value: string) => void
  readonly onIdentityLookupSubmit?: () => void
  readonly onUnlockAccount?: () => void
  readonly onLockAccount?: () => void
  readonly onSelectAccount?: (accountId: string | null) => void
  readonly onSelectAddress?: (addressId: string) => void
  readonly onAccountManage?: (action: HomeV2AccountManageAction) => void
  readonly onCreateAccount?: () => void
  readonly onImportAccount?: () => void
  readonly onToggleRememberUnlock?: () => void
  readonly onToggleLockOnExit?: () => void
  readonly onSetTheme?: (theme: HomeV2ThemePreference) => void
  readonly onSetAccent?: (accent: HomeV2Accent) => void
  readonly onSetTextSize?: (textSize: HomeV2TextSize) => void
  readonly onSetUiStyle?: (ui: HomeV2UiStyle) => void
  readonly onSetAppZoom?: (appZoom: number) => void
  readonly onSetLanguage?: (language: HomeV2Language) => void
  readonly onSetBookmarkToolbarVisibility?: (
    visibility: BookmarkToolbarVisibility,
  ) => void | Promise<void>
  readonly onSetNewTabPreference?: (preference: NewTabPreference) => void
  readonly onSetAppNotifications?: (enabled: boolean) => Promise<void>
  readonly onSetWindowBehavior?: (change: HomeV2WindowBehaviorChange) => Promise<void>
  readonly onOpenReleaseNotes?: (target: HomeV2ReleaseNotesTarget) => void
  readonly onWelcomeAccountAction?: (action: 'create' | 'import' | 'private') => void
  readonly onWelcomeComplete?: (
    destination: 'appearance' | 'dashboard',
  ) => void
  readonly onWelcomeSkip?: () => void
  readonly onWelcomeStepChange?: (step: HomeV2OnboardingStep) => void
  readonly onRestartWelcome?: () => void
  readonly onOpenCoreDocs?: (network: NetworkId) => void
}

function NewTabPage(props: HomeV2PrototypeProps) {
  const result = props.identityLookup
  const stateLabel = props.identityLookupBusy
    ? t('home2.newTab.state.searching')
    : result?.state === 'conflict'
      ? t('home2.newTab.state.conflict')
      : result?.state === 'partial'
        ? t('home2.newTab.state.partial')
        : result?.state === 'not-found'
          ? t('home2.newTab.state.notFound')
          : result?.state === 'unavailable'
            ? t('home2.newTab.state.unavailable')
            : result
              ? t('home2.newTab.state.resolved')
              : t('home2.newTab.state.publicLookup')
  return (
    <section className="home-v2-new-tab-page" aria-labelledby="new-tab-title">
      <header className="home-v2-new-tab-intro">
        <span className="home-v2-eyebrow">home://newtab</span>
        <h1 id="new-tab-title">{t('home2.newTab.title')}</h1>
        <p>{t('home2.newTab.subtitle')}</p>
      </header>
      <div className="home-v2-panel home-v2-identity-lookup">
      <div className="home-v2-section-heading">
        <h2>{t('home2.newTab.registeredAccounts')}</h2>
        <span className="home-v2-lookup-state" data-lookup-state={result?.state ?? 'idle'}>
          {stateLabel}
        </span>
      </div>
      <form
        className="home-v2-identity-search"
        onSubmit={(event) => {
          event.preventDefault()
          props.onIdentityLookupSubmit?.()
        }}
      >
        <label>
          <span>{t('home2.newTab.addressOrName')}</span>
          <input
            aria-label={t('home2.newTab.inputLabel')}
            autoComplete="off"
            disabled={!props.onIdentityLookupInput}
            placeholder={t('home2.newTab.placeholder')}
            spellCheck={false}
            value={props.identityLookupInput ?? ''}
            onChange={(event) => props.onIdentityLookupInput?.(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="home-v2-primary-button"
          disabled={
            !props.onIdentityLookupSubmit ||
            props.identityLookupBusy ||
            !(props.identityLookupInput ?? '').trim()
          }
        >
          {props.identityLookupBusy
            ? t('home2.newTab.searching')
            : t('home2.newTab.search')}
        </button>
      </form>
      <div className="home-v2-identity-result" aria-live="polite">
        {props.identityLookupError ? (
          <p className="home-v2-lookup-message" data-lookup-tone="error">
            {props.identityLookupError}
          </p>
        ) : result ? (
          <>
            <p
              className="home-v2-lookup-message"
              data-lookup-tone={result.state === 'conflict' ? 'warning' : 'neutral'}
            >
              {result.message}
            </p>
            <div className="home-v2-identity-network-grid">
              {(['qortium', 'qortal'] as const).map((network) => {
                const identity = result.networks[network]
                return (
                  <article
                    className="home-v2-identity-network"
                    data-identity-state={identity.state}
                    data-network={network}
                    key={network}
                  >
                    <VisibleIdentityAvatar
                      identity={identity}
                      loader={props.loadVisibleAvatar}
                      network={network}
                      query={result.query}
                    />
                    <div className="home-v2-identity-network__copy">
                      <NetworkBadge network={network} />
                      <strong>
                        {identity.primaryName ??
                          (identity.state === 'not-found'
                            ? t('home2.identity.nameNotRegistered')
                            : identity.state === 'unavailable'
                              ? t('home2.identity.nodeUnavailable')
                              : t('home2.identity.noPrimaryName'))}
                      </strong>
                      {identity.address ? <code>{identity.address}</code> : null}
                      <small>
                        {identity.names.length > 0
                          ? t('home2.identity.names', {
                              names: identity.names.join(', '),
                            })
                          : identity.detail}
                      </small>
                      {identity.avatar ? (
                        <small>
                          {t('home2.identity.avatar', {
                            coordinate: `${identity.avatar.service}/${identity.avatar.name}/${identity.avatar.identifier}`,
                          })}
                        </small>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          </>
        ) : (
          <p className="home-v2-lookup-placeholder">
            {t('home2.newTab.placeholderDescription')}
          </p>
        )}
      </div>
      </div>
    </section>
  )
}

function IdentityPresence({
  snapshot,
  network,
  lookup,
  loader,
}: {
  readonly snapshot: HomeV2Snapshot
  readonly network: NetworkId
  readonly lookup?: DualIdentityLookupResult | null
  readonly loader?: VisibleAvatarLoader
}) {
  const presence = snapshot.identity.presences[network]
  const publicIdentity = lookup?.networks[network]
  return (
    <article className="home-v2-presence" data-network={network}>
      {publicIdentity ? (
        <VisibleIdentityAvatar
          identity={publicIdentity}
          loader={loader}
          network={network}
          query={lookup?.query ?? presence.address ?? ''}
        />
      ) : (
        <div className="home-v2-presence__avatar" aria-hidden="true">
          {presence.avatar?.value ?? '?'}
        </div>
      )}
      <div className="home-v2-presence__details">
        <NetworkBadge network={network} />
        <strong>
          {presence.primaryName ?? t('home2.identity.noRegisteredName')}
        </strong>
        <code>{presence.address ?? t('home2.identity.noAddress')}</code>
      </div>
    </article>
  )
}

function AccountCard({
  snapshot,
  onUnlockAccount,
  onLockAccount,
  onSelectAccount,
  onCreateAccount,
  onImportAccount,
  accountCatalogue,
  vaultState,
  selectedAccountId,
  selectedAccountLookup,
  loadVisibleAvatar,
  onSelectAddress,
  onAccountManage,
}: Pick<
  HomeV2PrototypeProps,
  | 'snapshot'
  | 'onUnlockAccount'
  | 'onLockAccount'
  | 'onSelectAccount'
  | 'onCreateAccount'
  | 'onImportAccount'
  | 'accountCatalogue'
  | 'vaultState'
  | 'selectedAccountId'
  | 'selectedAccountLookup'
  | 'loadVisibleAvatar'
  | 'onSelectAddress'
  | 'onAccountManage'
>) {
  const hasAccount = snapshot.account.state !== 'none'
  const isLocked = snapshot.account.state === 'locked'
  const handleSelection = (selection: HomeV2AccountSelection) => {
    if (selection === 'create') {
      onCreateAccount?.()
      return
    }
    if (selection === 'import') {
      onImportAccount?.()
      return
    }
    if (selection === 'private') {
      onAccountManage?.('import-private-key')
      return
    }
    if (selection === 'none') {
      onSelectAccount?.(null)
      return
    }
    if (selection.startsWith('account:')) {
      onSelectAccount?.(selection.slice('account:'.length))
    }
  }
  const accountOptions = vaultState?.accounts ?? []
  const selectedVaultAccount = accountOptions.find(
    (account) => account.id === vaultState?.selectedAccountId,
  )
  const selectedValue = vaultState
    ? vaultState.selectedAccountId
      ? `account:${vaultState.selectedAccountId}`
      : 'none'
    : hasAccount
      ? 'current'
      : 'none'
  const enabledNetworks = (['qortium', 'qortal'] as const).filter(
    (network) => snapshot.nodes[network].mode !== 'disabled',
  )

  return (
    <section className="home-v2-panel home-v2-account-panel">
      <div className="home-v2-section-heading">
        <h2>{t('account.menuLabel')}</h2>
        <span
          className="home-v2-lock-state"
          data-account-state={snapshot.account.state}
        >
          {!hasAccount
            ? t('home2.account.notSelected')
            : isLocked
              ? t('account.statusLocked')
              : t('account.statusUnlocked')}
        </span>
      </div>
      <div className="home-v2-account-control-row">
        <label className="home-v2-account-select">
          <span>{t('home2.account.selected')}</span>
          <select
            aria-label={t('home2.account.selected')}
            value={selectedValue}
            disabled={!onSelectAccount && !onCreateAccount && !onImportAccount}
            onChange={(event) =>
              handleSelection(event.target.value as HomeV2AccountSelection)
            }
          >
            <optgroup label={t('account.title')}>
              <option value="none">{t('account.noAccountSelected')}</option>
              {vaultState ? (
                accountOptions.map((account) => (
                  <option value={`account:${account.id}`} key={account.id}>
                    {account.label} · {account.addresses[0]?.address.slice(0, 8)}…
                  </option>
                ))
              ) : (
                <option value="current">{snapshot.identity.displayLabel}</option>
              )}
            </optgroup>
            <optgroup label={t('home2.account.actions')}>
              <option value="create" disabled={!onCreateAccount}>{t('home2.account.create')}</option>
              <option value="import" disabled={!onImportAccount}>{t('home2.account.import')}</option>
              <option value="private" disabled={!onAccountManage}>{t('home2.account.importPrivateKey')}</option>
            </optgroup>
          </select>
        </label>
        <button
          type="button"
          className="home-v2-primary-button"
          disabled={
            !hasAccount
              ? !onCreateAccount
              : isLocked
                ? !onUnlockAccount
                : !onLockAccount
          }
          onClick={
            !hasAccount
              ? onCreateAccount
              : isLocked
                ? onUnlockAccount
                : onLockAccount
          }
        >
          {!hasAccount
            ? t('home2.account.new')
            : isLocked
              ? t('home2.account.unlock')
              : t('home2.account.lock')}
        </button>
      </div>
      {selectedVaultAccount && selectedVaultAccount.addresses.length > 1 ? (
        <div className="home-v2-account-secondary-row">
          <label className="home-v2-account-select">
            <span>{t('home2.account.selectedAddress')}</span>
            <select
              aria-label={t('home2.account.selectedAddress')}
              value={vaultState?.selectedAddressId ?? selectedVaultAccount.addresses[0].id}
              onChange={(event) => onSelectAddress?.(event.target.value)}
            >
              {selectedVaultAccount.addresses.map((address) => (
                <option key={address.id} value={address.id}>
                  {address.label} · {address.address.slice(0, 8)}…
                </option>
              ))}
            </select>
          </label>
          <label className="home-v2-account-select">
            <span>{t('home2.account.manage')}</span>
            <select
              aria-label={t('home2.account.manageLabel')}
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) onAccountManage?.(event.target.value as HomeV2AccountManageAction)
                event.target.value = ''
              }}
            >
              <option value="" disabled>{t('home2.account.chooseAction')}</option>
              <option value="rename">{t('home2.account.rename')}</option>
              <option value="export">{t('home2.account.exportWallet')}</option>
              <option value="add-address" disabled={!selectedVaultAccount.supportsDerivedAddresses}>{t('home2.account.addAddress')}</option>
              <option value="remove-address" disabled={(vaultState?.selectedAddressId ?? selectedVaultAccount.id) === selectedVaultAccount.id}>{t('home2.account.removeAddress')}</option>
              <option value="import-private-key">{t('home2.account.importPrivateKey')}</option>
              <option value="remove-account">{t('home2.account.remove')}</option>
            </select>
          </label>
        </div>
      ) : selectedVaultAccount ? (
        <div className="home-v2-account-secondary-row home-v2-account-secondary-row--single">
          <span className="home-v2-account-address">{selectedVaultAccount.addresses[0]?.address}</span>
          <label className="home-v2-account-select">
            <span>{t('home2.account.manage')}</span>
            <select
              aria-label={t('home2.account.manageLabel')}
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) onAccountManage?.(event.target.value as HomeV2AccountManageAction)
                event.target.value = ''
              }}
            >
              <option value="" disabled>{t('home2.account.chooseAction')}</option>
              <option value="rename">{t('home2.account.rename')}</option>
              <option value="export">{t('home2.account.exportWallet')}</option>
              <option value="add-address" disabled={!selectedVaultAccount.supportsDerivedAddresses}>{t('home2.account.addAddress')}</option>
              <option value="import-private-key">{t('home2.account.importPrivateKey')}</option>
              <option value="remove-account">{t('home2.account.remove')}</option>
            </select>
          </label>
        </div>
      ) : null}
      {vaultState?.readiness === 'recovery' ? (
        <p className="home-v2-account-recovery" role="alert">
          {vaultState.recoveryMessage ?? t('home2.account.recoveryRequired')}
        </p>
      ) : null}
      <div className="home-v2-account-content">
        {hasAccount ? (
          enabledNetworks.length > 0 ? (
            <div className="home-v2-presence-list">
              {enabledNetworks.map((network) => (
                <IdentityPresence
                  key={network}
                  snapshot={snapshot}
                  network={network}
                  lookup={selectedAccountLookup}
                  loader={loadVisibleAvatar}
                />
              ))}
            </div>
          ) : null
        ) : (
          <div className="home-v2-account-placeholder">
            <strong>{t('account.noAccountSelected')}</strong>
            <span>{t('home2.account.publicControlsAvailable')}</span>
          </div>
        )}
      </div>
    </section>
  )
}

type DashboardProps = HomeV2PrototypeProps & {
  readonly onOpenSettingsSection?: (
    section: HomeV2SettingsSectionTarget,
  ) => void
}

function Dashboard(props: DashboardProps) {
  const {
    snapshot,
    onSetNodeMode,
    onRefreshNode,
    onConfigureCustomNode,
  } = props
  const pinnedApps = props.pinnedApps ?? {
    pins: [],
    status: 'ready' as const,
    onAdd: () => undefined,
    onMove: () => undefined,
    onReorder: () => undefined,
    onOpen: () => undefined,
    onRemove: () => undefined,
    onRename: () => undefined,
  }
  const enabledNetworks = (['qortium', 'qortal'] as const).filter(
    (network) => snapshot.nodes[network].mode !== 'disabled',
  )
  const qortiumEnabled = enabledNetworks.includes('qortium')
  const visiblePins = pinnedApps.pins.filter((pin) => {
    const address = pin.displayUrl.trim().toLowerCase()
    if (address.startsWith('home://')) return true
    if (address.startsWith('qortal://') || address.startsWith('qortal-core://')) {
      return enabledNetworks.includes('qortal')
    }
    return qortiumEnabled
  })
  return (
    <div className="home-v2-dashboard">
      <header className="home-v2-dashboard-intro">
        <h1>{t('common.dashboard')}</h1>
        {props.surfaceNotice ? (
          <span className="home-v2-surface-notice">
            {translateMainProcessMessage(props.surfaceNotice)}
          </span>
        ) : null}
      </header>

      {qortiumEnabled || visiblePins.length > 0 ? (
        <HomeV2PinnedApps
          {...pinnedApps}
          allowAdd={qortiumEnabled}
          loadVisibleAppIcon={props.loadVisibleAppIcon}
          pins={visiblePins}
        />
      ) : null}

      <HomeV2NodeCoreSection
        snapshot={snapshot}
        networks={enabledNetworks}
        appUpdates={props.appUpdates}
        coreManagement={props.coreManagement}
        onChainCoreUpdates={props.onChainCoreUpdates}
        onSetNodeMode={onSetNodeMode}
        onRefreshNode={onRefreshNode}
        onConfigureCustomNode={onConfigureCustomNode}
        onOpenCoreDocs={props.onOpenCoreDocs}
        onOpenSettings={
          props.onOpenSettingsSection
            ? () => props.onOpenSettingsSection?.('core')
            : undefined
        }
      />

      <AccountCard {...props} />

    </div>
  )
}

export function HomeV2Prototype(props: HomeV2PrototypeProps) {
  const [requestedSettingsSection, setRequestedSettingsSection] =
    useState<HomeV2SettingsSectionTarget>('general')
  // Renderer-local shortcut targets; assigned after the guarded tab handlers
  // exist so the once-mounted key listener always sees current-render state.
  const localShortcuts = useRef<{
    cycleTab: (offset: -1 | 1) => boolean
    selectTab: (index: number) => boolean
    reload: () => boolean
  }>({
    cycleTab: () => false,
    selectTab: () => false,
    reload: () => false,
  })
  const textSizeControl = useRef({
    current: props.snapshot.appearance.textSize,
    update: props.onSetTextSize,
  })
  textSizeControl.current = {
    current: props.snapshot.appearance.textSize,
    update: props.onSetTextSize,
  }
  useEffect(() => {
    const applyTextSizeCommand = (
      command:
        | 'text-size-decrease'
        | 'text-size-increase'
        | 'text-size-reset',
    ) => {
      const control = textSizeControl.current
      if (!control.update) return false
      const next =
        command === 'text-size-reset'
          ? 'medium'
          : stepHomeV2TextSize(
              control.current,
              command === 'text-size-increase' ? 'increase' : 'decrease',
            )
      control.current = next
      control.update(next)
      return true
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      const key = event.key.toLowerCase()
      const primary = event.ctrlKey || event.metaKey
      // Text size: Ctrl/Cmd+Shift +/-/0. Ctrl/Cmd without Shift is native
      // window zoom, handled by the main process before it reaches the DOM.
      if (primary && event.shiftKey && !event.altKey) {
        const command =
          key === '+' || key === '='
            ? 'text-size-increase'
            : key === '-' || key === '_'
              ? 'text-size-decrease'
              : key === '0' || key === ')'
                ? 'text-size-reset'
                : null
        if (command && applyTextSizeCommand(command)) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
      }
      const shortcuts = localShortcuts.current
      if (event.ctrlKey && !event.altKey && key === 'tab') {
        if (shortcuts.cycleTab(event.shiftKey ? -1 : 1)) event.preventDefault()
        return
      }
      if (primary && !event.altKey && !event.shiftKey) {
        if (key === 'pageup' || key === 'pagedown') {
          if (shortcuts.cycleTab(key === 'pageup' ? -1 : 1)) {
            event.preventDefault()
          }
          return
        }
        if (/^[1-9]$/.test(key)) {
          // Ctrl/Cmd+9 selects the last tab, matching browser convention.
          if (shortcuts.selectTab(key === '9' ? -1 : Number(key) - 1)) {
            event.preventDefault()
          }
          return
        }
      }
      if (key === 'f5' && !primary && !event.altKey && !event.shiftKey) {
        if (shortcuts.reload()) event.preventDefault()
      }
    }
    // Ctrl/Cmd+wheel steps native window zoom; with Shift it steps text size.
    // One mouse notch reports a large delta, so consuming the accumulator at
    // the threshold keeps one notch = one step while trackpad deltas gather.
    // Skipped when the zoom bridge is absent (Android; pinch zoom is native).
    let wheelAccumulator = 0
    const handleWheel = (event: WheelEvent) => {
      if (!window.homeV2Zoom) return
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX
      if (delta === 0) return
      if (
        (wheelAccumulator > 0 && delta < 0) ||
        (wheelAccumulator < 0 && delta > 0)
      ) {
        wheelAccumulator = 0
      }
      wheelAccumulator += delta
      if (Math.abs(wheelAccumulator) < 50) return
      const direction = wheelAccumulator < 0 ? 'in' : 'out'
      wheelAccumulator = 0
      if (event.shiftKey) {
        applyTextSizeCommand(
          direction === 'in' ? 'text-size-increase' : 'text-size-decrease',
        )
      } else {
        void stepHomeV2WindowZoom(direction)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('wheel', handleWheel, {
      capture: true,
      passive: false,
    })
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('wheel', handleWheel, true)
    }
  }, [])
  const translationVersion = useHomeV2Translation(
    props.snapshot.appearance.resolvedLanguage,
  )
  const {
    snapshot,
    productState,
    permissionState,
    layout,
    onActivateTab,
    onCloseTab,
    onOpenInternalTab,
    onReorderTab,
    onNavigate,
    onResolvePermission,
  } = props
  const activeTab = productState.tabs.find(
    (tab) => tab.id === productState.activeTabId,
  )
  // A toolbar popover is open. Deliberately separate from `appOverlayActive`:
  // that one also disables navigation and forces the owning tab active, which
  // is right for a trusted prompt and wrong for a menu. This reaches nothing
  // but the app stage's `suspended`, because suspending the native view is the
  // only way a menu can be seen over an app page at all.
  const [chromeOverlayOpen, setChromeOverlayOpen] = useState(false)
  const permissionOverlayTabId = permissionState.pending[0]?.context.tabId
  const appOverlayActive =
    !!activeTab &&
    (permissionOverlayTabId === activeTab.id ||
      props.appOverlayTabId === activeTab.id)
  // While a prompt owns a still-open tab, navigation away is refused up front
  // rather than repaired afterwards: a transient deactivation unmounts the
  // Android app iframe, which is a full reload that kills the pending request.
  const rawOverlayTabId = permissionOverlayTabId ?? props.appOverlayTabId ?? null
  const overlayOwnerTabId =
    rawOverlayTabId && productState.tabs.some((tab) => tab.id === rawOverlayTabId)
      ? rawOverlayTabId
      : null
  const guardedActivateTab = overlayOwnerTabId
    ? (tabId: ProductState['tabs'][number]['id']) => {
        if (tabId === overlayOwnerTabId) onActivateTab?.(tabId)
      }
    : onActivateTab
  const guardedNavigate = overlayOwnerTabId
    ? () => undefined
    : (destination: Exclude<ShellDestination, 'tab'>) => {
        // Deliberately does NOT reset the Settings section: returning to an
        // open Settings tab must leave it where the user left it. Deep links
        // still choose a section through openSettingsSection().
        onNavigate?.(destination)
      }
  const openSettingsSection = (section: HomeV2SettingsSectionTarget) => {
    if (overlayOwnerTabId) return
    setRequestedSettingsSection(section)
    onNavigate?.('settings')
  }
  // Menu close-tab targets the active app tab. Refused while a trusted
  // overlay owns a tab — closing under a pending prompt would strand it.
  // Each tab remembers where it was scrolled to. The document is the scroll
  // container, so switching tabs would otherwise dump every page at the top.
  const nativeZoom = hasHomeV2NativeZoom()
  useEffect(() => {
    if (!nativeZoom) return
    void setHomeV2WindowZoom(snapshot.appearance.appZoom)
  }, [nativeZoom, snapshot.appearance.appZoom])

  const scrollByTab = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const target = scrollByTab.current.get(productState.activeTabId as string) ?? 0
    window.scrollTo(0, target)
    if (target === 0) return
    // Pages that fill in asynchronously (Settings waits on Core status) are
    // still short at this point, so the browser clamps the restore to 0.
    // Retry over the next few frames until the position is reachable, and
    // stop as soon as the user scrolls somewhere themselves.
    let cancelled = false
    let frames = 0
    const settle = () => {
      // ~3s of frames: Settings waits on Core status over the network before
      // it is tall enough for a deep restore to be reachable.
      if (cancelled || frames >= 180) return
      frames += 1
      if (Math.abs(window.scrollY - target) > 1) window.scrollTo(0, target)
      if (window.scrollY !== target) requestAnimationFrame(settle)
    }
    const stop = () => { cancelled = true }
    window.addEventListener('wheel', stop, { once: true, passive: true })
    window.addEventListener('touchstart', stop, { once: true, passive: true })
    window.addEventListener('keydown', stop, { once: true })
    requestAnimationFrame(settle)
    return () => {
      cancelled = true
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchstart', stop)
      window.removeEventListener('keydown', stop)
    }
  }, [productState.activeTabId])
  useEffect(() => {
    const tabId = productState.activeTabId as string
    const onScroll = () => scrollByTab.current.set(tabId, window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [productState.activeTabId])

  const closeActiveTabCommand = useRef<() => void>(() => {})
  closeActiveTabCommand.current = () => {
    if (overlayOwnerTabId) return
    onCloseTab?.(productState.activeTabId)
  }
  useEffect(
    () =>
      subscribeHomeV2MenuCommands((command) => {
        if (command === 'close-tab') closeActiveTabCommand.current()
      }),
    [],
  )
  localShortcuts.current = {
    cycleTab: (offset) => {
      if (productState.tabs.length === 0 || !guardedActivateTab) return false
      const ids = productState.tabs.map((tab) => tab.id)
      const currentIndex =
        productState.destination === 'tab' && productState.activeTabId
          ? ids.indexOf(productState.activeTabId)
          : -1
      const nextIndex =
        currentIndex < 0
          ? offset === 1
            ? 0
            : ids.length - 1
          : (currentIndex + offset + ids.length) % ids.length
      guardedActivateTab(ids[nextIndex])
      return true
    },
    selectTab: (index) => {
      if (!guardedActivateTab) return false
      const target =
        index === -1
          ? productState.tabs[productState.tabs.length - 1]
          : productState.tabs[index]
      if (!target) return false
      guardedActivateTab(target.id)
      return true
    },
    reload: () => {
      if (!props.onReload) return false
      props.onReload()
      return true
    },
  }

  return (
    <div
      className="home-v2-shell"
      data-layout={layout}
      data-theme={snapshot.appearance.resolvedTheme}
      data-theme-preference={snapshot.appearance.theme}
      data-accent={snapshot.appearance.accent}
      data-text-size={snapshot.appearance.textSize}
      data-language={snapshot.appearance.language}
      data-resolved-language={snapshot.appearance.resolvedLanguage}
      lang={snapshot.appearance.resolvedLanguage}
      dir={
        isHomeV2RtlLanguage(snapshot.appearance.resolvedLanguage)
          ? 'rtl'
          : 'ltr'
      }
      style={
        {
          // Native zoom does the scaling on desktop, so the CSS zoom must stay
          // neutral there; `100vh` is not zoom-aware and a CSS-zoomed shell
          // overflows the window. Android has no native zoom bridge and keeps
          // the CSS path.
          '--v2-app-zoom': nativeZoom ? 1 : snapshot.appearance.appZoom / 100,
        } as CSSProperties
      }
    >
      <BrowserChrome
        snapshot={snapshot}
        productState={productState}
        onActivateTab={guardedActivateTab}
        onCloseTab={onCloseTab}
        onOpenInternalTab={
          overlayOwnerTabId ? undefined : onOpenInternalTab
        }
        onReorderTab={onReorderTab}
        onNavigate={guardedNavigate}
        onOpenAddress={props.onOpenAddress}
        onOpenAsWidget={props.onOpenAsWidget}
        widgetAvailable={props.widgetAvailable}
        canGoBack={props.canGoBack}
        canGoForward={props.canGoForward}
        onGoBack={props.onGoBack}
        onGoForward={props.onGoForward}
        onReload={props.onReload}
        navigationDisabled={!!overlayOwnerTabId}
        newTabPreference={props.newTabPreference}
        releaseNotesAddress={
          productState.destination === 'releases' && props.releaseNotesTarget
            ? `home://releases/${props.releaseNotesTarget.product}/${encodeURIComponent(props.releaseNotesTarget.tagName)}`
            : undefined
        }
        coreDocsAddress={
          productState.destination === 'core-docs' && props.coreDocsNetwork
            ? props.coreDocsNetwork === 'qortal'
              ? 'qortal-core://'
              : 'core://'
            : undefined
        }
        selectedAccountLookup={props.selectedAccountLookup}
        loadVisibleAvatar={props.loadVisibleAvatar}
        loadVisibleAppIcon={props.loadVisibleAppIcon}
        bookmarkToolbar={
          props.bookmarkToolbar
            ? {
                ...props.bookmarkToolbar,
                disabled:
                  !!overlayOwnerTabId || props.bookmarkToolbar.disabled,
              }
            : undefined
        }
        onToggleCurrentBookmark={props.onToggleCurrentBookmark}
        onManageBookmarks={props.onManageBookmarks}
        onSetBookmarkToolbarVisibility={props.onSetBookmarkToolbarVisibility}
        onDropTabOnBookmarkToolbar={props.onDropTabOnBookmarkToolbar}
        onDetachTab={props.onDetachTab}
        onLockAccount={props.onLockAccount}
        onUnlockAccount={props.onUnlockAccount}
        coreManagement={props.coreManagement}
        onConfigureCustomNode={props.onConfigureCustomNode}
        onOpenCoreSettings={() => openSettingsSection('core')}
        onSetNodeMode={props.onSetNodeMode}
        onOverlayOpenChange={setChromeOverlayOpen}
      />
      <main
        className="home-v2-page-viewport"
        data-app-active={activeTab ? 'true' : 'false'}
        data-app-overlay-active={appOverlayActive ? 'true' : 'false'}
      >
        {productState.transient ? (
          productState.destination === 'core-docs' &&
          props.coreDocsNetwork &&
          props.coreDocsTransport &&
          props.probeCoreDocs ? (
          <HomeV2CoreApiDocsPage
            enable={props.enableCoreDocs}
            network={props.coreDocsNetwork}
            probe={props.probeCoreDocs}
            snapshot={snapshot}
            transport={props.coreDocsTransport}
            onOpenCoreSettings={() => openSettingsSection('core')}
          />
          ) : productState.transient === 'releases' && props.releaseNotesTarget ? (
          <HomeV2ReleaseNotesPage
            target={props.releaseNotesTarget}
            onNavigate={props.onOpenReleaseNotes ?? (() => undefined)}
          />
          ) : productState.transient === 'releases' ? (
          <section className="home-v2-internal-page" role="alert">
            <h1>{t('releaseNotes.loadFailed')}</h1>
          </section>
          ) : productState.transient === 'core-docs' ? (
          <section className="home-v2-internal-page" role="alert">
            <h1>{t('api.loadFailed')}</h1>
          </section>
          ) : null
        ) : null}
        {/* Every open tab stays mounted and is merely hidden when inactive:
            unmounting would throw away scroll position, form state and any
            in-progress work the moment the user glanced at another tab. */}
        {productState.entries.map((entry) => {
          const isActive = entry.id === productState.activeTabId
          if (entry.kind === 'app') {
            // App tabs keep their own persistence: on desktop the native view
            // survives hidden, on Android the stage is keyed per tab.
            return isActive && !productState.transient ? (
              <AppTabStage
                productState={productState}
                snapshot={snapshot}
                translationVersion={translationVersion}
                nodeClient={props.nodeClient}
                selectedAccountId={props.selectedAccountId}
                managerRevisions={props.managerRevisions}
                reloadVersion={props.appReloadVersion}
                suspended={appOverlayActive || chromeOverlayOpen}
                onNavigationChanged={props.onAppNavigationChanged}
                onNavigationControllerChange={props.onAppNavigationControllerChange}
                onOpenAddress={props.onOpenAddress}
                onOpenAddressInTab={props.onOpenAddressInTab}
                onTitleChanged={props.onAppTitleChanged}
                requestApp={props.requestApp}
              />
            ) : null
          }
          return (
            <div
              className="home-v2-page-slot"
              key={entry.id}
              data-internal-page={entry.page}
              hidden={!isActive || !!productState.transient}
            >
              {entry.page === 'settings' ? (
              <SettingsPage
                appearance={snapshot.appearance}
                account={snapshot.account}
                nodes={snapshot.nodes}
                newTabPreference={
                  props.newTabPreference ?? { kind: 'search' }
                }
                onSetTheme={props.onSetTheme}
                onSetAccent={props.onSetAccent}
                onSetTextSize={props.onSetTextSize}
                onSetUiStyle={props.onSetUiStyle}
                onSetAppZoom={props.onSetAppZoom}
                onSetLanguage={props.onSetLanguage}
                bookmarkToolbarVisibility={props.bookmarkToolbarVisibility}
                onSetBookmarkToolbarVisibility={
                  props.onSetBookmarkToolbarVisibility
                }
                onSetNewTabPreference={props.onSetNewTabPreference}
                onSetNodeMode={props.onSetNodeMode}
                onToggleRememberUnlock={props.onToggleRememberUnlock}
                onToggleLockOnExit={props.onToggleLockOnExit}
                coreManagement={props.coreManagement}
                maintenance={props.maintenance}
                appUpdates={props.appUpdates}
                onChainCoreUpdates={props.onChainCoreUpdates}
                qdnAppsManagement={props.qdnAppsManagement}
                resolveAccountLabel={props.resolveAccountLabel}
                loadVisibleAppIcon={props.loadVisibleAppIcon}
                notificationPolicy={props.notificationPolicy}
                onSetAppNotifications={props.onSetAppNotifications}
                windowBehavior={props.windowBehavior}
                onSetWindowBehavior={props.onSetWindowBehavior}
                onOpenReleaseNotes={(tagName) => props.onOpenReleaseNotes?.({
                  product: 'home',
                  tagName,
                })}
                onRestartWelcome={props.onRestartWelcome}
                requestedSection={requestedSettingsSection}
              />
              ) : entry.page === 'newtab' ? (
                <NewTabPage {...props} />
              ) : entry.page === 'dashboard' ? (
                <Dashboard {...props} onOpenSettingsSection={openSettingsSection} />
              ) : entry.page === 'welcome' ? (
                props.onboarding ? (
              <HomeV2WelcomePage
                accountCatalogue={props.accountCatalogue}
                coreManagement={props.coreManagement}
                maintenance={props.maintenance}
                onboarding={props.onboarding}
                snapshot={snapshot}
                vaultState={props.vaultState}
                onAccountAction={props.onWelcomeAccountAction}
                onComplete={(destination) => {
                  if (destination === 'appearance') setRequestedSettingsSection('appearance')
                  props.onWelcomeComplete?.(destination)
                }}
                onConfigureCustomNode={() => props.onConfigureCustomNode?.('qortium')}
                onOpenNames={() => void props.onOpenAddress?.('qdn://APP/Names/Names')}
                onSetNodeMode={(mode) => props.onSetNodeMode?.('qortium', mode)}
                onSkip={props.onWelcomeSkip}
                onStepChange={props.onWelcomeStepChange}
              />
                ) : (
                  <section className="home-v2-internal-page" role="alert">
                    <h1>{t('welcome.error')}</h1>
                  </section>
                )
              ) : null}
            </div>
          )
        })}
      </main>
      {props.overlay}
      <PermissionDialog
        activeTabId={activeTab?.id ?? null}
        loadVisibleAppIcon={props.loadVisibleAppIcon}
        permissionState={permissionState}
        onResolvePermission={onResolvePermission}
      />
    </div>
  )
}
