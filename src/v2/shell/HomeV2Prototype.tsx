import type { CSSProperties } from 'react'
import {
  isHomeV2RtlLanguage,
  type HomeV2Accent,
  type HomeV2Language,
  type HomeV2TextSize,
  type HomeV2ThemePreference,
} from '../appearance'
import type {
  AppDescriptor,
  HomeV2Snapshot,
  NetworkId,
  NodeConnectionMode,
} from '../contracts'
import type {
  PermissionDecision,
  PermissionRequestId,
  PermissionState,
} from '../bridge-permissions'
import type { ProductState, ShellDestination } from '../product-model'
import { AppTabStage } from './AppTabStage'
import { AppearanceSettingsPage } from './AppearanceSettingsPage'
import { BrowserChrome } from './BrowserChrome'
import { NetworkBadge, networkLabels } from './NetworkBadge'
import { PermissionDialog } from './PermissionDialog'
import './home-v2-prototype.css'

export type HomeV2Layout = 'desktop' | 'phone'
export type HomeV2AccountSelection = 'none' | 'current' | 'create' | 'import'

export interface HomeV2PrototypeProps {
  readonly snapshot: HomeV2Snapshot
  readonly productState: ProductState
  readonly permissionState: PermissionState
  readonly layout: HomeV2Layout
  readonly onOpenApp?: (app: AppDescriptor, targetNetwork: NetworkId) => void
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
  readonly onUnlockAccount?: () => void
  readonly onLockAccount?: () => void
  readonly onSelectAccount?: (
    selection: Extract<HomeV2AccountSelection, 'none' | 'current'>,
  ) => void
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

const nodeModeLabels: Readonly<Record<NodeConnectionMode, string>> = {
  disabled: 'Disabled',
  local: 'Local',
  public: 'Public',
  custom: 'Custom',
}

function IdentityPresence({
  snapshot,
  network,
}: {
  readonly snapshot: HomeV2Snapshot
  readonly network: NetworkId
}) {
  const presence = snapshot.identity.presences[network]
  return (
    <article className="home-v2-presence">
      <div className="home-v2-presence__avatar" aria-hidden="true">
        {presence.avatar?.value ?? '?'}
      </div>
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
}: {
  readonly snapshot: HomeV2Snapshot
  readonly network: NetworkId
  readonly onSetNodeMode?: HomeV2PrototypeProps['onSetNodeMode']
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
          <span aria-hidden="true" />
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
            <option key={mode} value={mode}>
              {nodeModeLabels[mode]}
            </option>
          ))}
        </select>
      </label>
      <p className="home-v2-node-detail">
        {node.mode === 'disabled'
          ? 'No connection'
          : `${nodeModeLabels[node.mode]} · ${node.label}`}
      </p>
      <button type="button" className="home-v2-link-button">
        Details
      </button>
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
}: Pick<
  HomeV2PrototypeProps,
  | 'snapshot'
  | 'onUnlockAccount'
  | 'onLockAccount'
  | 'onSelectAccount'
  | 'onCreateAccount'
  | 'onImportAccount'
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
    onSelectAccount?.(selection)
  }

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
            value={hasAccount ? 'current' : 'none'}
            onChange={(event) =>
              handleSelection(event.target.value as HomeV2AccountSelection)
            }
          >
            <optgroup label="Accounts">
              <option value="none">No account selected</option>
              <option value="current">{snapshot.identity.displayLabel}</option>
            </optgroup>
            <optgroup label="Account actions">
              <option value="create">Create account…</option>
              <option value="import">Import account…</option>
            </optgroup>
          </select>
        </label>
        <button
          type="button"
          className="home-v2-primary-button"
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
            <IdentityPresence snapshot={snapshot} network="qortal" />
            <IdentityPresence snapshot={snapshot} network="qortium" />
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
        aria-label={`${app.title} networks`}
      >
        {app.targetNetworks.map((network) => (
          <button
            key={network}
            type="button"
            onClick={() => onOpenApp?.(app, network)}
          >
            <NetworkBadge network={network} />
            Open
          </button>
        ))}
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
  const { snapshot, onOpenApp, onSetNodeMode } = props
  const pinnedApps = snapshot.apps.filter((app) => app.placement === 'pinned')
  return (
    <div className="home-v2-dashboard">
      <header className="home-v2-dashboard-intro">
        <h1>Dashboard</h1>
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
          />
          <NodeCard
            snapshot={snapshot}
            network="qortium"
            onSetNodeMode={onSetNodeMode}
          />
        </div>
      </section>

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
      />
      <main className="home-v2-page-viewport">
        {activeTab ? (
          <AppTabStage productState={productState} />
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
      <PermissionDialog
        permissionState={permissionState}
        onResolvePermission={onResolvePermission}
      />
    </div>
  )
}
