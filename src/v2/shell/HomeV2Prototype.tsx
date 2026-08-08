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
  readonly onAddAccount?: () => void
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
      <div
        className="home-v2-node-modes"
        aria-label={`${networkLabels[network]} connection mode`}
      >
        {(Object.keys(nodeModeLabels) as NodeConnectionMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            className={node.mode === mode ? 'is-active' : ''}
            aria-pressed={node.mode === mode}
            onClick={() => onSetNodeMode?.(network, mode)}
          >
            {nodeModeLabels[mode]}
          </button>
        ))}
      </div>
      <p>
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
  onAddAccount,
  onToggleRememberUnlock,
  onToggleLockOnExit,
}: Pick<
  HomeV2PrototypeProps,
  | 'snapshot'
  | 'onUnlockAccount'
  | 'onLockAccount'
  | 'onAddAccount'
  | 'onToggleRememberUnlock'
  | 'onToggleLockOnExit'
>) {
  if (snapshot.account.state === 'none') {
    return (
      <section className="home-v2-panel home-v2-account-empty">
        <div>
          <h2>No account selected</h2>
          <p>Public apps remain available.</p>
        </div>
        <button
          type="button"
          className="home-v2-primary-button"
          onClick={onAddAccount}
        >
          Add or import account
        </button>
      </section>
    )
  }

  const isLocked = snapshot.account.state === 'locked'
  return (
    <section className="home-v2-panel home-v2-account-panel">
      <div className="home-v2-section-heading">
        <div>
          <h2>Account</h2>
          <p>{snapshot.identity.displayLabel}</p>
        </div>
        <span className="home-v2-lock-state" data-locked={isLocked}>
          {isLocked ? 'Locked' : 'Unlocked'}
        </span>
      </div>
      <div className="home-v2-presence-list">
        <IdentityPresence snapshot={snapshot} network="qortal" />
        <IdentityPresence snapshot={snapshot} network="qortium" />
      </div>
      <div className="home-v2-account-options">
        <label>
          <input
            type="checkbox"
            checked={snapshot.account.rememberUnlock}
            disabled={!snapshot.account.secureStorageAvailable}
            readOnly={!onToggleRememberUnlock}
            onChange={onToggleRememberUnlock}
          />
          Remember unlock on this device
        </label>
        <label>
          <input
            type="checkbox"
            checked={snapshot.account.lockOnExit}
            readOnly={!onToggleLockOnExit}
            onChange={onToggleLockOnExit}
          />
          Lock on exit
        </label>
      </div>
      <div className="home-v2-account-actions">
        <button
          type="button"
          className="home-v2-primary-button"
          onClick={isLocked ? onUnlockAccount : onLockAccount}
        >
          {isLocked ? 'Unlock account' : 'Lock account'}
        </button>
        <button type="button" className="home-v2-secondary-button">
          Switch account
        </button>
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
        <div>
          <h1>Dashboard</h1>
        </div>
        <button
          type="button"
          className="home-v2-secondary-button"
          onClick={() => props.onNavigate?.('settings')}
        >
          Settings
        </button>
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
            onSetTheme={props.onSetTheme}
            onSetAccent={props.onSetAccent}
            onSetTextSize={props.onSetTextSize}
            onSetAppZoom={props.onSetAppZoom}
            onSetLanguage={props.onSetLanguage}
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
