import type { CSSProperties, ReactNode } from 'react'
import {
  isHomeV2RtlLanguage,
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
import {
  AppTabStage,
  type AppTabNavigationController,
  type AppTabNavigationSnapshot,
} from './AppTabStage'
import { AppearanceSettingsPage } from './AppearanceSettingsPage'
import { BrowserChrome, type AddressOpenResult } from './BrowserChrome'
import { NetworkBadge, networkLabels } from './NetworkBadge'
import { PermissionDialog } from './PermissionDialog'
import { VisibleIdentityAvatar } from './VisibleIdentityAvatar'
import type {
  HomeV2AppBridgeProtocol,
  HomeV2AppRequestContext,
  HomeV2NodeClient,
} from '../../home-v2-live/node-client'
import './home-v2-prototype.css'

export type HomeV2Layout = 'desktop' | 'phone'
export type HomeV2AccountSelection = 'none' | 'current' | 'create' | 'import' | `account:${string}`

export interface HomeV2PrototypeProps {
  readonly snapshot: HomeV2Snapshot
  readonly productState: ProductState
  readonly permissionState: PermissionState
  readonly layout: HomeV2Layout
  readonly surfaceNotice?: string
  readonly overlay?: ReactNode
  readonly identityLookup?: DualIdentityLookupResult | null
  readonly identityLookupBusy?: boolean
  readonly identityLookupError?: string | null
  readonly identityLookupInput?: string
  readonly loadVisibleAvatar?: VisibleAvatarLoader
  readonly accountCatalogue?: HomeV2AccountCatalogue
  readonly selectedAccountId?: string | null
  readonly appReloadVersion?: number
  readonly selectedAccountLookup?: DualIdentityLookupResult | null
  readonly nodeClient?: HomeV2NodeClient | null
  readonly requestApp?: (
    protocol: HomeV2AppBridgeProtocol,
    request: unknown,
    context: HomeV2AppRequestContext,
  ) => Promise<unknown>
  readonly onOpenApp?: (app: AppDescriptor) => void
  readonly onOpenAddress?: (address: string) => Promise<AddressOpenResult>
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
  readonly onCreateAccount?: () => void
  readonly onImportAccount?: () => void
  readonly onToggleRememberUnlock?: () => void
  readonly onToggleLockOnExit?: () => void
  readonly onSetTheme?: (theme: HomeV2ThemePreference) => void
  readonly onSetAccent?: (accent: HomeV2Accent) => void
  readonly onSetTextSize?: (textSize: HomeV2TextSize) => void
  readonly onSetAppZoom?: (appZoom: number) => void
  readonly onSetLanguage?: (language: HomeV2Language) => void
}

function IdentityLookupCard(props: HomeV2PrototypeProps) {
  const result = props.identityLookup
  const stateLabel = props.identityLookupBusy
    ? 'Searching'
    : result?.state === 'conflict'
      ? 'Name conflict'
      : result?.state === 'partial'
        ? 'Partial result'
        : result?.state === 'not-found'
          ? 'Not found'
          : result?.state === 'unavailable'
            ? 'Unavailable'
            : result
              ? 'Resolved'
              : 'Public lookup'
  return (
    <section className="home-v2-panel home-v2-identity-lookup" aria-labelledby="identity-lookup-title">
      <div className="home-v2-section-heading">
        <h2 id="identity-lookup-title">Account lookup</h2>
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
          <span>Address or name</span>
          <input
            aria-label="Account address or name"
            autoComplete="off"
            disabled={!props.onIdentityLookupInput}
            placeholder="Enter a Qortal or Qortium address or name"
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
          {props.identityLookupBusy ? 'Searching…' : 'Search'}
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
              {(['qortal', 'qortium'] as const).map((network) => {
                const identity = result.networks[network]
                return (
                  <article
                    className="home-v2-identity-network"
                    data-identity-state={identity.state}
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
                            ? 'Name not registered'
                            : identity.state === 'unavailable'
                              ? 'Node unavailable'
                              : 'No primary name')}
                      </strong>
                      {identity.address ? <code>{identity.address}</code> : null}
                      <small>
                        {identity.names.length > 0
                          ? `Names: ${identity.names.join(', ')}`
                          : identity.detail}
                      </small>
                      {identity.avatar ? (
                        <small>
                          Avatar: {identity.avatar.service}/{identity.avatar.name}/
                          {identity.avatar.identifier}
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
            Search public name records across both networks. Matching names are grouped only when their owner address is the same.
          </p>
        )}
      </div>
    </section>
  )
}

const nodeModeLabels: Readonly<Record<NodeConnectionMode, string>> = {
  disabled: 'Disabled',
  local: 'Local',
  public: 'Public',
  custom: 'Custom',
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
    <article className="home-v2-presence">
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
        <strong>{presence.primaryName ?? 'No registered name'}</strong>
        <code>{presence.address ?? 'No address on this network'}</code>
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
          <h3>{networkLabels[network]} connection</h3>
        </div>
        <span className="home-v2-node-state" data-node-state={node.state}>
          <span className="home-v2-status-dot" aria-hidden="true" />
          {node.statusText}
        </span>
      </header>
      <label className="home-v2-node-mode-control">
        <span>Connection mode</span>
        <select
          aria-label={`${networkLabels[network]} connection mode`}
          value={node.mode}
          onChange={(event) =>
            onSetNodeMode?.(network, event.target.value as NodeConnectionMode)
          }
        >
          {(Object.keys(nodeModeLabels) as NodeConnectionMode[]).map((mode) => (
            <option
              key={mode}
              value={mode}
              disabled={mode === 'custom' && !node.customConfigured}
            >
              {nodeModeLabels[mode]}
              {mode === 'custom' && !node.customConfigured
                ? ' (not configured)'
                : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="home-v2-node-detail">
        <span>
          {node.mode === 'disabled'
            ? 'No connection'
            : `${nodeModeLabels[node.mode]} · ${node.label}`}
        </span>
        <small>
          {node.error ??
            ([
              node.height === null
                ? null
                : `Height ${node.height.toLocaleString()}`,
              node.peerCount === null ? null : `${node.peerCount} peers`,
            ]
              .filter(Boolean)
              .join(' · ') || 'Waiting for node status')}
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
            Configure
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
            Refresh
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
  selectedAccountId,
  selectedAccountLookup,
  loadVisibleAvatar,
}: Pick<
  HomeV2PrototypeProps,
  | 'snapshot'
  | 'onUnlockAccount'
  | 'onLockAccount'
  | 'onSelectAccount'
  | 'onCreateAccount'
  | 'onImportAccount'
  | 'accountCatalogue'
  | 'selectedAccountId'
  | 'selectedAccountLookup'
  | 'loadVisibleAvatar'
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
    if (selection === 'none') {
      onSelectAccount?.(null)
      return
    }
    if (selection.startsWith('account:')) {
      onSelectAccount?.(selection.slice('account:'.length))
    }
  }
  const accountOptions = accountCatalogue?.accounts ?? []
  const selectedValue = accountCatalogue
    ? selectedAccountId
      ? `account:${selectedAccountId}`
      : 'none'
    : hasAccount
      ? 'current'
      : 'none'

  return (
    <section className="home-v2-panel home-v2-account-panel">
      <div className="home-v2-section-heading">
        <h2>Account</h2>
        <span
          className="home-v2-lock-state"
          data-account-state={snapshot.account.state}
        >
          {!hasAccount ? 'Not selected' : isLocked ? 'Locked' : 'Unlocked'}
        </span>
      </div>
      <div className="home-v2-account-control-row">
        <label className="home-v2-account-select">
          <span>Selected account</span>
          <select
            aria-label="Selected account"
            value={selectedValue}
            disabled={!onSelectAccount && !onCreateAccount && !onImportAccount}
            onChange={(event) =>
              handleSelection(event.target.value as HomeV2AccountSelection)
            }
          >
            <optgroup label="Accounts">
              <option value="none">No account selected</option>
              {accountCatalogue ? (
                accountOptions.map((account) => (
                  <option value={`account:${account.id}`} key={account.id}>
                    {account.label} · {account.address.slice(0, 8)}…
                  </option>
                ))
              ) : (
                <option value="current">{snapshot.identity.displayLabel}</option>
              )}
            </optgroup>
            <optgroup label="Account actions">
              <option value="create" disabled={!onCreateAccount}>Create account…</option>
              <option value="import" disabled={!onImportAccount}>Import account…</option>
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
            ? 'New Account'
            : isLocked
              ? 'Unlock account'
              : 'Lock account'}
        </button>
      </div>
      <div className="home-v2-account-content">
        {hasAccount ? (
          <div className="home-v2-presence-list">
            <IdentityPresence
              snapshot={snapshot}
              network="qortal"
              lookup={selectedAccountLookup}
              loader={loadVisibleAvatar}
            />
            <IdentityPresence
              snapshot={snapshot}
              network="qortium"
              lookup={selectedAccountLookup}
              loader={loadVisibleAvatar}
            />
          </div>
        ) : (
          <div className="home-v2-account-placeholder">
            <strong>No account selected</strong>
            <span>Public apps and connection controls remain available.</span>
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
        aria-label={`${app.title} availability`}
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
          Open
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
    'tab' | 'dashboard' | 'settings'
  >
}) {
  const copy = {
    activity: ['Activity', 'Downloads, notifications, and recent actions.'],
    apps: ['Apps', 'Browse, search, and organize QDN apps.'],
  } as const
  return (
    <section className="home-v2-internal-page">
      <span className="home-v2-eyebrow">home://{destination}</span>
      <h1>{copy[destination][0]}</h1>
      <p>{copy[destination][1]}</p>
      <small>Not connected in this offline preview.</small>
    </section>
  )
}

function Dashboard(props: HomeV2PrototypeProps) {
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
        <h1>Dashboard</h1>
        {props.surfaceNotice ? (
          <span className="home-v2-surface-notice">{props.surfaceNotice}</span>
        ) : null}
      </header>

      <section
        className="home-v2-connections"
        aria-labelledby="connections-title"
      >
        <div className="home-v2-section-heading">
          <div>
            <h2 id="connections-title">Connections</h2>
          </div>
        </div>
        <div className="home-v2-node-grid">
          <NodeCard
            snapshot={snapshot}
            network="qortal"
            onSetNodeMode={onSetNodeMode}
            onRefreshNode={onRefreshNode}
            onConfigureCustomNode={onConfigureCustomNode}
          />
          <NodeCard
            snapshot={snapshot}
            network="qortium"
            onSetNodeMode={onSetNodeMode}
            onRefreshNode={onRefreshNode}
            onConfigureCustomNode={onConfigureCustomNode}
          />
        </div>
      </section>

      <IdentityLookupCard {...props} />

      <AccountCard {...props} />

      <section className="home-v2-launcher" aria-labelledby="pinned-apps-title">
        <div className="home-v2-section-heading">
          <div>
            <h2 id="pinned-apps-title">Pinned apps</h2>
          </div>
          <button
            type="button"
            className="home-v2-link-button"
            onClick={() => props.onNavigate?.('apps')}
          >
            Browse apps
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
        onActivateTab={onActivateTab}
        onCloseTab={onCloseTab}
        onNavigate={onNavigate}
        onOpenAddress={props.onOpenAddress}
        canGoBack={props.canGoBack}
        canGoForward={props.canGoForward}
        onGoBack={props.onGoBack}
        onGoForward={props.onGoForward}
        onReload={props.onReload}
      />
      <main
        className="home-v2-page-viewport"
        data-app-active={activeTab ? 'true' : 'false'}
      >
        {activeTab ? (
          <AppTabStage
            productState={productState}
            snapshot={snapshot}
            nodeClient={props.nodeClient}
            selectedAccountId={props.selectedAccountId}
            reloadVersion={props.appReloadVersion}
            onNavigationChanged={props.onAppNavigationChanged}
            onNavigationControllerChange={props.onAppNavigationControllerChange}
            onOpenAddress={props.onOpenAddress}
            onTitleChanged={props.onAppTitleChanged}
            requestApp={props.requestApp}
          />
        ) : productState.destination === 'settings' ? (
          <AppearanceSettingsPage
            appearance={snapshot.appearance}
            account={snapshot.account}
            onSetTheme={props.onSetTheme}
            onSetAccent={props.onSetAccent}
            onSetTextSize={props.onSetTextSize}
            onSetAppZoom={props.onSetAppZoom}
            onSetLanguage={props.onSetLanguage}
            onToggleRememberUnlock={props.onToggleRememberUnlock}
            onToggleLockOnExit={props.onToggleLockOnExit}
          />
        ) : productState.destination === 'dashboard' ||
          productState.destination === 'tab' ? (
          <Dashboard {...props} />
        ) : (
          <InternalPage destination={productState.destination} />
        )}
      </main>
      {props.overlay}
      <PermissionDialog
        permissionState={permissionState}
        onResolvePermission={onResolvePermission}
      />
    </div>
  )
}
