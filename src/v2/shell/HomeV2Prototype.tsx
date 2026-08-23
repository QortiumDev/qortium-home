import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { t, type TranslationKey } from '../../i18n'
import { translateMainProcessMessage } from '../../mainProcessMessage'
import {
  isHomeV2RtlLanguage,
  stepHomeV2TextSize,
  type HomeV2Accent,
  type HomeV2Language,
  type HomeV2TextSize,
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
  VisibleAvatarLoader,
} from '../contracts'
import type {
  PermissionDecision,
  PermissionRequestId,
  PermissionState,
} from '../bridge-permissions'
import type { ProductState, ShellDestination } from '../product-model'
import type { NewTabPreference } from '../new-tab-preference'
import { useHomeV2Translation } from '../i18n'
import {
  AppTabStage,
  type AppTabNavigationController,
  type AppTabNavigationSnapshot,
} from './AppTabStage'
import { BrowserChrome, type AddressOpenResult } from './BrowserChrome'
import { NetworkBadge, networkLabels } from './NetworkBadge'
import { PermissionDialog } from './PermissionDialog'
import { VisibleIdentityAvatar } from './VisibleIdentityAvatar'
import {
  SettingsPage,
  type HomeV2SettingsSectionTarget,
} from './SettingsPage'
import {
  CoreManagerCards,
  type HomeV2CoreManagement,
} from './CoreManagerCards'
import type {
  HomeV2AppBridgeProtocol,
  HomeV2AppRequestContext,
  HomeV2NodeClient,
} from '../../home-v2-live/node-client'
import type { HomeV2AppUpdates } from '../../home-v2-live/app-update-controller'
import type { HomeV2QdnSettingsManagement } from '../../home-v2-live/qdn-settings-client'
import type { HomeV2NotificationPolicyState } from '../../home-v2-live/notification-policy-client'
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
  readonly accountCatalogue?: HomeV2AccountCatalogue
  readonly vaultState?: HomeV2VaultState
  readonly selectedAccountId?: string | null
  readonly appReloadVersion?: number
  readonly selectedAccountLookup?: DualIdentityLookupResult | null
  readonly nodeClient?: HomeV2NodeClient | null
  readonly coreManagement?: HomeV2CoreManagement
  readonly appUpdates?: HomeV2AppUpdates
  readonly qdnAppsManagement?: HomeV2QdnSettingsManagement
  readonly notificationPolicy?: HomeV2NotificationPolicyState | null
  readonly requestApp?: (
    protocol: HomeV2AppBridgeProtocol,
    request: unknown,
    context: HomeV2AppRequestContext,
  ) => Promise<unknown>
  readonly onOpenApp?: (app: AppDescriptor) => void
  readonly onOpenAddress?: (address: string) => Promise<AddressOpenResult>
  readonly onOpenAsWidget?: (tabId: string) => Promise<string | null>
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
  ) => void
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
  readonly onSetAppZoom?: (appZoom: number) => void
  readonly onSetLanguage?: (language: HomeV2Language) => void
  readonly onSetNewTabPreference?: (preference: NewTabPreference) => void
  readonly onSetAppNotifications?: (enabled: boolean) => Promise<void>
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

const nodeModeLabelKeys: Readonly<Record<NodeConnectionMode, TranslationKey>> = {
  disabled: 'home2.node.mode.disabled',
  local: 'home2.node.mode.local',
  public: 'home2.node.mode.public',
  custom: 'home2.node.mode.custom',
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

function NodeCard({
  snapshot,
  network,
  onSetNodeMode,
  onRefreshNode,
  onConfigureCustomNode,
}: {
  readonly snapshot: HomeV2Snapshot
  readonly network: NetworkId
  readonly onSetNodeMode?: HomeV2PrototypeProps['onSetNodeMode']
  readonly onRefreshNode?: HomeV2PrototypeProps['onRefreshNode']
  readonly onConfigureCustomNode?: HomeV2PrototypeProps['onConfigureCustomNode']
}) {
  const node = snapshot.nodes[network]
  return (
    <article className="home-v2-node-card" data-network={network}>
      <header>
        <div>
          <NetworkBadge network={network} />
          <h3>
            {t('home2.node.connectionTitle', {
              network: networkLabels[network],
            })}
          </h3>
        </div>
        <span className="home-v2-node-state" data-node-state={node.state}>
          <span className="home-v2-status-dot" aria-hidden="true" />
          {node.statusText}
        </span>
      </header>
      <label className="home-v2-node-mode-control">
        <span>{t('home2.node.connectionMode')}</span>
        <select
          aria-label={t('home2.node.connectionModeFor', {
            network: networkLabels[network],
          })}
          value={node.mode}
          onChange={(event) =>
            onSetNodeMode?.(network, event.target.value as NodeConnectionMode)
          }
        >
          {(Object.keys(nodeModeLabelKeys) as NodeConnectionMode[]).map((mode) => (
            <option
              key={mode}
              value={mode}
              disabled={mode === 'custom' && !node.customConfigured}
            >
              {t(nodeModeLabelKeys[mode])}
              {mode === 'custom' && !node.customConfigured
                ? ` (${t('home2.node.notConfigured')})`
                : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="home-v2-node-detail">
        <span>
          {node.mode === 'disabled'
            ? t('home2.node.noConnection')
            : `${t(nodeModeLabelKeys[node.mode])} · ${node.label}`}
        </span>
        <small>
          {node.error ??
            ([
              node.height === null
                ? null
                : t('home2.node.height', {
                    height: node.height.toLocaleString(),
                  }),
              node.peerCount === null
                ? null
                : t('home2.node.peers', { count: node.peerCount }),
            ]
              .filter(Boolean)
              .join(' · ') || t('home2.node.waitingForStatus'))}
        </small>
        <small>{node.localCoreStatusText}</small>
      </div>
      <div className="home-v2-node-actions">
        {onConfigureCustomNode ? (
          <button
            type="button"
            className="home-v2-link-button"
            onClick={() => onConfigureCustomNode(network)}
          >
            {t('home2.node.configure')}
          </button>
        ) : (
          <span aria-hidden="true" />
        )}
        {onRefreshNode ? (
          <button
            type="button"
            className="home-v2-link-button"
            onClick={() => onRefreshNode(network)}
          >
            {t('common.refresh')}
          </button>
        ) : (
          <span aria-hidden="true" />
        )}
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
              <option value="add-address" disabled={!selectedVaultAccount.supportsDerivedAddresses || !selectedVaultAccount.isUnlocked}>{t('home2.account.addAddress')}</option>
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
              <option value="add-address" disabled={!selectedVaultAccount.supportsDerivedAddresses || !selectedVaultAccount.isUnlocked}>{t('home2.account.addAddress')}</option>
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
          <div className="home-v2-presence-list">
            <IdentityPresence
              snapshot={snapshot}
              network="qortium"
              lookup={selectedAccountLookup}
              loader={loadVisibleAvatar}
            />
            <IdentityPresence
              snapshot={snapshot}
              network="qortal"
              lookup={selectedAccountLookup}
              loader={loadVisibleAvatar}
            />
          </div>
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

function AppCard({
  app,
  onOpenApp,
}: {
  readonly app: AppDescriptor
  readonly onOpenApp?: HomeV2PrototypeProps['onOpenApp']
}) {
  return (
    <article className="home-v2-app-card" data-app-id={app.id}>
      <div className="home-v2-app-card__icon" aria-hidden="true">
        {app.title.slice(0, 1)}
      </div>
      <div className="home-v2-app-card__copy">
        <h3>{app.title}</h3>
        <p>{app.description}</p>
      </div>
      <div
        className="home-v2-app-card__actions"
        aria-label={t('home2.account.availability', { app: app.title })}
      >
        <div className="home-v2-app-card__networks">
          {app.targetNetworks.map((network) => (
            <NetworkBadge key={network} network={network} />
          ))}
        </div>
        <button
          type="button"
          disabled={!onOpenApp}
          onClick={() => onOpenApp?.(app)}
        >
          {t('common.open')}
        </button>
      </div>
    </article>
  )
}

function InternalPage({
  destination,
}: {
  readonly destination: Exclude<
    ShellDestination,
    'tab' | 'dashboard' | 'newtab' | 'settings'
  >
}) {
  const copy: Record<typeof destination, readonly [TranslationKey, TranslationKey]> = {
    activity: ['home2.activity', 'home2.internal.activityDescription'],
    apps: ['home2.apps', 'home2.internal.appsDescription'],
  } as const
  return (
    <section className="home-v2-internal-page">
      <span className="home-v2-eyebrow">home://{destination}</span>
      <h1>{t(copy[destination][0])}</h1>
      <p>{t(copy[destination][1])}</p>
      <small>{t('home2.internal.offlinePreview')}</small>
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
    onOpenApp,
    onSetNodeMode,
    onRefreshNode,
    onConfigureCustomNode,
  } = props
  const pinnedApps = snapshot.apps.filter((app) => app.placement === 'pinned')
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

      <section
        className="home-v2-connections"
        aria-labelledby="connections-title"
      >
        <div className="home-v2-section-heading">
          <div>
            <h2 id="connections-title">{t('connections.title')}</h2>
          </div>
        </div>
        <div className="home-v2-node-grid">
          <NodeCard
            snapshot={snapshot}
            network="qortium"
            onSetNodeMode={onSetNodeMode}
            onRefreshNode={onRefreshNode}
            onConfigureCustomNode={onConfigureCustomNode}
          />
          <NodeCard
            snapshot={snapshot}
            network="qortal"
            onSetNodeMode={onSetNodeMode}
            onRefreshNode={onRefreshNode}
            onConfigureCustomNode={onConfigureCustomNode}
          />
        </div>
      </section>

      {props.coreManagement?.available ? (
        <section
          className="home-v2-core-management"
          aria-labelledby="core-management-title"
        >
          <div className="home-v2-section-heading">
            <div>
              <h2 id="core-management-title">{t('home2.core.title')}</h2>
              <p>{t('home2.core.dashboardDescription')}</p>
            </div>
            <button
              type="button"
              className="home-v2-link-button"
              aria-label={`${t('common.settings')}: ${t('home2.core.title')}`}
              onClick={() => props.onOpenSettingsSection?.('core')}
            >
              {t('common.settings')}
            </button>
          </div>
          <CoreManagerCards management={props.coreManagement} />
        </section>
      ) : null}

      <AccountCard {...props} />

      <section className="home-v2-launcher" aria-labelledby="pinned-apps-title">
        <div className="home-v2-section-heading">
          <div>
            <h2 id="pinned-apps-title">{t('home2.dashboard.pinnedApps')}</h2>
          </div>
          <button
            type="button"
            className="home-v2-link-button"
            onClick={() => props.onNavigate?.('apps')}
          >
            {t('home2.account.browseApps')}
          </button>
        </div>
        <div className="home-v2-app-grid">
          {pinnedApps.map((app) => (
            <AppCard key={app.id} app={app} onOpenApp={onOpenApp} />
          ))}
        </div>
      </section>
    </div>
  )
}

export function HomeV2Prototype(props: HomeV2PrototypeProps) {
  const [requestedSettingsSection, setRequestedSettingsSection] =
    useState<HomeV2SettingsSectionTarget>('general')
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
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        !event.shiftKey ||
        (!event.ctrlKey && !event.metaKey)
      ) {
        return
      }
      const key = event.key.toLowerCase()
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
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
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
    onNavigate,
    onResolvePermission,
  } = props
  const activeTab = productState.tabs.find(
    (tab) => tab.id === productState.activeTabId,
  )
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
        if (destination === 'settings') setRequestedSettingsSection('general')
        onNavigate?.(destination)
      }
  const openSettingsSection = (section: HomeV2SettingsSectionTarget) => {
    if (overlayOwnerTabId) return
    setRequestedSettingsSection(section)
    onNavigate?.('settings')
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
          '--v2-app-zoom': snapshot.appearance.appZoom / 100,
        } as CSSProperties
      }
    >
      <BrowserChrome
        snapshot={snapshot}
        productState={productState}
        onActivateTab={guardedActivateTab}
        onCloseTab={onCloseTab}
        onNavigate={guardedNavigate}
        onOpenAddress={props.onOpenAddress}
        onOpenAsWidget={props.onOpenAsWidget}
        canGoBack={props.canGoBack}
        canGoForward={props.canGoForward}
        onGoBack={props.onGoBack}
        onGoForward={props.onGoForward}
        onReload={props.onReload}
        navigationDisabled={!!overlayOwnerTabId}
        newTabPreference={props.newTabPreference}
      />
      <main
        className="home-v2-page-viewport"
        data-app-active={activeTab ? 'true' : 'false'}
        data-app-overlay-active={appOverlayActive ? 'true' : 'false'}
      >
        {activeTab ? (
          <AppTabStage
            productState={productState}
            snapshot={snapshot}
            translationVersion={translationVersion}
            nodeClient={props.nodeClient}
            selectedAccountId={props.selectedAccountId}
            reloadVersion={props.appReloadVersion}
            suspended={appOverlayActive}
            onNavigationChanged={props.onAppNavigationChanged}
            onNavigationControllerChange={props.onAppNavigationControllerChange}
            onOpenAddress={props.onOpenAddress}
            onTitleChanged={props.onAppTitleChanged}
            requestApp={props.requestApp}
          />
        ) : productState.destination === 'settings' ? (
          <SettingsPage
            appearance={snapshot.appearance}
            account={snapshot.account}
            newTabPreference={
              props.newTabPreference ?? { kind: 'search' }
            }
            onSetTheme={props.onSetTheme}
            onSetAccent={props.onSetAccent}
            onSetTextSize={props.onSetTextSize}
            onSetAppZoom={props.onSetAppZoom}
            onSetLanguage={props.onSetLanguage}
            onSetNewTabPreference={props.onSetNewTabPreference}
            onToggleRememberUnlock={props.onToggleRememberUnlock}
            onToggleLockOnExit={props.onToggleLockOnExit}
            coreManagement={props.coreManagement}
            appUpdates={props.appUpdates}
            qdnAppsManagement={props.qdnAppsManagement}
            notificationPolicy={props.notificationPolicy}
            onSetAppNotifications={props.onSetAppNotifications}
            requestedSection={requestedSettingsSection}
          />
        ) : productState.destination === 'dashboard' ||
          productState.destination === 'tab' ? (
          <Dashboard
            {...props}
            onOpenSettingsSection={openSettingsSection}
          />
        ) : productState.destination === 'newtab' ? (
          <NewTabPage {...props} />
        ) : (
          <InternalPage destination={productState.destination} />
        )}
      </main>
      {props.overlay}
      <PermissionDialog
        activeTabId={activeTab?.id ?? null}
        permissionState={permissionState}
        onResolvePermission={onResolvePermission}
      />
    </div>
  )
}
