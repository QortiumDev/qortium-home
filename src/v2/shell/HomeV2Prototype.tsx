import type { AppDescriptor, HomeV2Snapshot, NetworkId } from '../contracts'
import './home-v2-prototype.css'

export type HomeV2Layout = 'desktop' | 'phone'

export interface HomeV2PrototypeProps {
  readonly snapshot: HomeV2Snapshot
  readonly layout: HomeV2Layout
  readonly onOpenApp?: (app: AppDescriptor, targetNetwork: NetworkId) => void
}

const networkLabels: Readonly<Record<NetworkId, string>> = {
  qortal: 'Qortal',
  qortium: 'Qortium',
}

function NetworkBadge({ network }: { readonly network: NetworkId }) {
  return (
    <span className={`home-v2-network home-v2-network--${network}`}>
      {networkLabels[network]}
    </span>
  )
}

function BrandMark() {
  return (
    <span className="home-v2-brand-mark" aria-hidden="true">
      <span />
      <span />
    </span>
  )
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
      <span
        className={`home-v2-presence__state home-v2-presence__state--${presence.state}`}
      >
        {presence.state}
      </span>
    </article>
  )
}

function NodeStatus({
  snapshot,
  network,
}: {
  readonly snapshot: HomeV2Snapshot
  readonly network: NetworkId
}) {
  const node = snapshot.nodes[network]
  return (
    <article className="home-v2-node">
      <span
        className={`home-v2-node__dot home-v2-node__dot--${node.state}`}
        aria-hidden="true"
      />
      <div>
        <span>{networkLabels[network]}</span>
        <strong>{node.statusText}</strong>
      </div>
    </article>
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
        <div className="home-v2-app-card__title">
          <h3>{app.title}</h3>
          <NetworkBadge network={app.sourceNetwork} />
        </div>
        <p>{app.description}</p>
      </div>
      <div className="home-v2-app-card__actions" aria-label={`${app.title} networks`}>
        {app.targetNetworks.map((network) => (
          <button
            key={network}
            type="button"
            onClick={() => onOpenApp?.(app, network)}
          >
            Open on {networkLabels[network]}
          </button>
        ))}
      </div>
    </article>
  )
}

export function HomeV2Prototype({
  snapshot,
  layout,
  onOpenApp,
}: HomeV2PrototypeProps) {
  const pinnedApps = snapshot.apps.filter((app) => app.placement === 'pinned')
  const recommendedApps = snapshot.apps.filter(
    (app) => app.placement === 'recommended',
  )

  return (
    <div className="home-v2-shell" data-layout={layout}>
      <aside className="home-v2-sidebar" aria-label="Primary navigation">
        <div className="home-v2-brand" aria-label="Qortium Home 2.0">
          <BrandMark />
          <span>
            <strong>Qortium</strong>
            <small>Home 2.0</small>
          </span>
        </div>
        <nav>
          <button type="button" className="is-active" data-nav-label="Dashboard">
            <span aria-hidden="true">◫</span>
            Dashboard
          </button>
          <button type="button" data-nav-label="Apps">
            <span aria-hidden="true">◇</span>
            Apps
          </button>
          <button type="button" data-nav-label="Activity">
            <span aria-hidden="true">↺</span>
            Activity
          </button>
          <button type="button" data-nav-label="Settings">
            <span aria-hidden="true">⚙</span>
            Settings
          </button>
        </nav>
        <div className="home-v2-sidebar__footer">
          <span className="home-v2-status-light" aria-hidden="true" />
          Local fixture
        </div>
      </aside>

      <main className="home-v2-main">
        <header className="home-v2-topbar">
          <div>
            <span className="home-v2-eyebrow">Dashboard</span>
            <h1>Good to see you, {snapshot.identity.displayLabel}.</h1>
          </div>
          <button type="button" className="home-v2-identity-button">
            <span aria-hidden="true">{snapshot.identity.displayLabel.slice(0, 1)}</span>
            <strong>{snapshot.identity.displayLabel}</strong>
            <small>Both networks</small>
          </button>
        </header>

        <div className="home-v2-dashboard-grid">
          <section className="home-v2-panel home-v2-identity-panel">
            <div className="home-v2-section-heading">
              <div>
                <span className="home-v2-eyebrow">Selected identity</span>
                <h2>One person, clearly labelled presences</h2>
              </div>
              <button type="button" className="home-v2-text-button">
                View identity
              </button>
            </div>
            <div className="home-v2-presence-list">
              <IdentityPresence snapshot={snapshot} network="qortal" />
              <IdentityPresence snapshot={snapshot} network="qortium" />
            </div>
          </section>

          <section className="home-v2-panel home-v2-status-panel">
            <div className="home-v2-section-heading">
              <div>
                <span className="home-v2-eyebrow">Connections</span>
                <h2>Network status</h2>
              </div>
            </div>
            <div className="home-v2-node-list">
              <NodeStatus snapshot={snapshot} network="qortal" />
              <NodeStatus snapshot={snapshot} network="qortium" />
            </div>
            <div className="home-v2-reticulum">
              <div>
                <span>Reticulum</span>
                <strong>{snapshot.reticulum.statusText}</strong>
              </div>
              <span className="home-v2-optional">Optional</span>
            </div>
          </section>
        </div>

        <section className="home-v2-launcher" aria-labelledby="pinned-apps-title">
          <div className="home-v2-section-heading">
            <div>
              <span className="home-v2-eyebrow">Your workspace</span>
              <h2 id="pinned-apps-title">Pinned apps</h2>
            </div>
            <button type="button" className="home-v2-text-button">
              Browse all apps
            </button>
          </div>
          <div className="home-v2-app-grid">
            {pinnedApps.map((app) => (
              <AppCard key={app.id} app={app} onOpenApp={onOpenApp} />
            ))}
          </div>
        </section>

        <div className="home-v2-lower-grid">
          <section className="home-v2-panel" aria-labelledby="recent-title">
            <div className="home-v2-section-heading">
              <div>
                <span className="home-v2-eyebrow">Pick up where you left off</span>
                <h2 id="recent-title">Recent</h2>
              </div>
            </div>
            <div className="home-v2-recent-list">
              {snapshot.recentItems.map((item) => (
                <button type="button" key={item.id}>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.context}</small>
                  </span>
                  <NetworkBadge network={item.targetNetwork} />
                </button>
              ))}
            </div>
          </section>

          <section className="home-v2-panel" aria-labelledby="recommended-title">
            <div className="home-v2-section-heading">
              <div>
                <span className="home-v2-eyebrow">Discover</span>
                <h2 id="recommended-title">Recommended apps</h2>
              </div>
            </div>
            <div className="home-v2-compact-apps">
              {recommendedApps.map((app) => (
                <AppCard key={app.id} app={app} onOpenApp={onOpenApp} />
              ))}
            </div>
          </section>
        </div>
      </main>

      <nav className="home-v2-mobile-nav" aria-label="Primary navigation">
        <button type="button" className="is-active" data-nav-label="Dashboard">
          <span aria-hidden="true">◫</span>
          Dashboard
        </button>
        <button type="button" data-nav-label="Apps">
          <span aria-hidden="true">◇</span>
          Apps
        </button>
        <button type="button" data-nav-label="Activity">
          <span aria-hidden="true">↺</span>
          Activity
        </button>
        <button type="button" data-nav-label="Settings">
          <span aria-hidden="true">⚙</span>
          Settings
        </button>
      </nav>
    </div>
  )
}
