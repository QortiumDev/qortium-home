import type { ReactNode } from 'react'
import type { HomeV2AppUpdates } from '../../home-v2-live/app-update-controller'
import type { HomeV2CoreMaintenanceManagement } from '../../home-v2-live/core-maintenance-controller'
import type { HomeV2OnChainCoreUpdates } from '../../home-v2-live/on-chain-core-update-controller'
import type { HomeV2QortalMaintenanceManagement } from '../../home-v2-live/qortal-maintenance-controller'
import type {
  HomeV2SettableTransportMode,
  HomeV2TransportManagement,
} from '../../home-v2-live/transport-maintenance-controller'
import { t, type TranslationKey } from '../../i18n'
import type {
  HomeV2Snapshot,
  NetworkId,
  NodeConnectionMode,
} from '../contracts'
import { CoreManagerCard, type HomeV2CoreManagement } from './CoreManagerCards'
import { homeUpdateStatusText } from './HomeUpdateSettings'
import { NetworkBadge, networkLabels } from './NetworkBadge'
import { ensureLabel, routerStatusMessage } from './TransportMaintenancePanel'

const nodeModeLabelKeys: Readonly<Record<NodeConnectionMode, TranslationKey>> = {
  disabled: 'home2.node.mode.disabled',
  local: 'home2.node.mode.local',
  public: 'home2.node.mode.public',
  custom: 'home2.node.mode.custom',
}

export interface HomeV2NodeCoreSectionProps {
  /** Opens the release-notes page for a product. Absent = no links shown. */
  readonly onOpenReleaseNotes?: (target: { product: 'core' | 'home'; tagName: string }) => void
  readonly appUpdates?: HomeV2AppUpdates
  readonly coreManagement?: HomeV2CoreManagement
  /** The networks the user has enabled, in shell order. */
  readonly networks: readonly NetworkId[]
  readonly onChainCoreUpdates?: HomeV2OnChainCoreUpdates
  readonly snapshot: HomeV2Snapshot
  readonly onConfigureCustomNode?: (network: NetworkId) => void
  readonly onOpenCoreDocs?: (network: NetworkId) => void
  readonly onOpenSettings?: () => void
  readonly onRefreshNode?: (network: NetworkId) => void
  readonly onSetNodeMode?: (
    network: NetworkId,
    mode: NodeConnectionMode,
  ) => void | Promise<void>
}

function NodeConnection({
  snapshot,
  network,
  onSetNodeMode,
  onRefreshNode,
  onConfigureCustomNode,
  onOpenCoreDocs,
}: {
  readonly snapshot: HomeV2Snapshot
  readonly network: NetworkId
  readonly onSetNodeMode?: HomeV2NodeCoreSectionProps['onSetNodeMode']
  readonly onRefreshNode?: HomeV2NodeCoreSectionProps['onRefreshNode']
  readonly onConfigureCustomNode?: HomeV2NodeCoreSectionProps['onConfigureCustomNode']
  readonly onOpenCoreDocs?: HomeV2NodeCoreSectionProps['onOpenCoreDocs']
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
              // The transport split only appears when the node reports it. A Core
              // older than #282 omits the field, and showing "(0 via I2P)" there
              // would assert every peer is direct IP when we simply do not know.
              node.peerCount === null
                ? null
                : node.i2pPeerCount === null
                  ? t('home2.node.peers', { count: node.peerCount })
                  : t('home2.node.peersWithI2p', {
                      count: node.peerCount,
                      i2p: node.i2pPeerCount,
                    }),
              node.dataPeerCount === null
                ? null
                : node.i2pDataPeerCount === null
                  ? t('home2.node.dataPeers', { count: node.dataPeerCount })
                  : t('home2.node.dataPeersWithI2p', {
                      count: node.dataPeerCount,
                      i2p: node.i2pDataPeerCount,
                    }),
            ]
              .filter(Boolean)
              .join(' · ') || t('home2.node.waitingForStatus'))}
        </small>
        <small>{node.localCoreStatusText}</small>
      </div>
      <div className="home-v2-node-actions">
        {onOpenCoreDocs && node.capabilities.read ? (
          <button
            type="button"
            className="home-v2-link-button"
            onClick={() => onOpenCoreDocs(network)}
          >
            {t('coreApi.title')}
          </button>
        ) : null}
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

/**
 * Which Qortium Core install action the tile offers, gated in the Home 1.x
 * order so it is never a dead end: Java first, then an approved on-chain
 * update, then a verified GitHub release. Only one is ever offered at a time,
 * and the action row and its notice read the same plan.
 */
function coreLifecyclePlan(
  coreMaintenance?: HomeV2CoreMaintenanceManagement,
  onChainCoreUpdates?: HomeV2OnChainCoreUpdates,
) {
  const status = coreMaintenance?.status
  const release = coreMaintenance?.release
  const showJava = !!status?.capabilities.canInstallJava
  const showOnChain = !showJava && !!onChainCoreUpdates?.canInstall
  const showRelease = !showJava && !showOnChain &&
    !!release?.tag && release.action !== 'none'
  // An UPDATE to a Home-started Core no longer needs the Core stopped first:
  // Home stops it, replaces it and starts it again, restoring the old install
  // if that fails. Initial installs still require a stopped Core — there is no
  // previous version to fall back to.
  const canUpdateInPlace = release?.action !== undefined &&
    release.action !== 'initial-install' &&
    !!status?.capabilities.canUpdateRunningInPlace
  return {
    showJava,
    showOnChain,
    showRelease,
    // Home stops and restarts the Core itself; the button says so.
    releaseRestartsCore: showRelease && canUpdateInPlace && status?.core.runtime === 'running',
    // A verified release Home cannot install yet needs the reason spelled out;
    // a disabled button on its own reads as a broken tile.
    releaseBlocked: showRelease && status?.core.runtime !== 'stopped' && !canUpdateInPlace,
  } as const
}

/**
 * Install/update progress.
 *
 * Rendered from a parsed event, and only while something is running. Phases
 * without an honest denominator ("checking", "extracting") report percent as
 * null and get an indeterminate bar rather than an invented number — the point
 * is to show the user what is happening, not to fake precision.
 */
export function CoreProgressBar({
  progress,
}: {
  readonly progress?: {
    readonly action: string
    readonly kind: string
    readonly message: string
    readonly percent: number | null
  } | null
}) {
  if (!progress) return null
  const determinate = typeof progress.percent === 'number'
  return (
    <div
      className="home-v2-core-progress"
      data-home-v2-core-progress={progress.action}
      data-home-v2-core-progress-kind={progress.kind}
    >
      <div
        aria-label={progress.message}
        aria-valuemax={determinate ? 100 : undefined}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuenow={determinate ? progress.percent ?? undefined : undefined}
        className="home-v2-core-progress__track"
        data-indeterminate={determinate ? undefined : 'true'}
        role="progressbar"
      >
        <div
          className="home-v2-core-progress__fill"
          style={determinate ? { width: `${progress.percent}%` } : undefined}
        />
      </div>
      <span className="home-v2-core-progress__message">
        {determinate ? `${progress.message} ${progress.percent}%` : progress.message}
      </span>
    </div>
  )
}

function CoreLifecycleActions({
  coreMaintenance,
  network,
  onChainCoreUpdates,
  onOpenReleaseNotes,
  qortalMaintenance,
}: {
  readonly coreMaintenance?: HomeV2CoreMaintenanceManagement
  readonly network: NetworkId
  readonly onChainCoreUpdates?: HomeV2OnChainCoreUpdates
  readonly onOpenReleaseNotes?: (target: { product: 'core' | 'home'; tagName: string }) => void
  readonly qortalMaintenance?: HomeV2QortalMaintenanceManagement
}) {
  // Whether a network's row EXISTS is decided by whether that network is
  // enabled, which is known from the shell snapshot straight away. Whether its
  // controls are ready is a slower, separate question. Returning null while the
  // maintenance status loads answered the fast question with the slow one, so
  // the Qortal controls appeared out of nowhere a moment after the dashboard
  // had already settled.
  //
  // The row now says it is loading and keeps its place, the same as the I2P row.
  if (network === 'qortal') {
    const status = qortalMaintenance?.status
    if (!qortalMaintenance || !status) {
      return (
        <span className="home-v2-core-lifecycle-loading" data-home-v2-lifecycle="loading-qortal">
          {t('home2.common.loading')}
        </span>
      )
    }
    const { busy, release } = qortalMaintenance
    const showRun = !!release?.tag && release.action !== 'none'
    return (
      <>
        {status.capabilities.canCheckRelease && qortalMaintenance.onCheckRelease ? (
          <button
            type="button"
            className="home-v2-secondary-button"
            data-home-v2-node-core-action="qortal-check"
            disabled={busy !== null}
            onClick={qortalMaintenance.onCheckRelease}
          >
            {busy === 'check' ? t('common.checking') : t('updates.checkForUpdates')}
          </button>
        ) : null}
        {showRun && release && qortalMaintenance.onRunRelease ? (
          <button
            type="button"
            className="home-v2-primary-button"
            data-home-v2-node-core-action="qortal-release"
            disabled={busy !== null || !qortalMaintenance.actionAllowed}
            onClick={qortalMaintenance.onRunRelease}
          >
            {busy === 'action'
              ? t('home2.common.working')
              : release.action === 'initial-install'
                ? t('home2.qortalMaintenance.install')
                : t('home2.qortalMaintenance.update')}
          </button>
        ) : null}
      </>
    )
  }

  const status = coreMaintenance?.status
  if (!coreMaintenance || !status) {
    // Same for Qortium: its controls used to pop in too, just less noticeably
    // because its status usually arrives first.
    return (
      <span className="home-v2-core-lifecycle-loading" data-home-v2-lifecycle="loading-core">
        {t('home2.common.loading')}
      </span>
    )
  }
  const { busy, release } = coreMaintenance
  const plan = coreLifecyclePlan(coreMaintenance, onChainCoreUpdates)
  const { showJava, showOnChain, showRelease } = plan
  return (
    <>
      {!showRelease && coreMaintenance.onCheckRelease ? (
        <button
          type="button"
          className="home-v2-secondary-button"
          data-home-v2-node-core-action="core-check"
          disabled={busy !== null}
          onClick={coreMaintenance.onCheckRelease}
        >
          {busy === 'check' ? t('common.checking') : t('updates.checkForUpdates')}
        </button>
      ) : null}
      {showJava && coreMaintenance.onInstallJava ? (
        <button
          type="button"
          className="home-v2-secondary-button"
          data-home-v2-node-core-action="java"
          disabled={busy !== null}
          onClick={coreMaintenance.onInstallJava}
        >
          {busy === 'java'
            ? t('common.installing')
            : status.java.source === 'managed'
              ? t('core.updateJava')
              : t('core.installJava')}
        </button>
      ) : null}
      {showOnChain && onChainCoreUpdates ? (
        <button
          type="button"
          className="home-v2-primary-button"
          data-home-v2-node-core-action="on-chain"
          disabled={onChainCoreUpdates.busy !== null || !onChainCoreUpdates.authenticated}
          onClick={() => void onChainCoreUpdates.install()}
        >
          {onChainCoreUpdates.busy === 'install'
            ? t('common.installing')
            : t('core.installApprovedUpdate')}
        </button>
      ) : null}
      {showRelease && release && coreMaintenance.onRunRelease ? (
        <button
          type="button"
          className="home-v2-primary-button"
          data-home-v2-node-core-action="core-release"
          disabled={busy !== null || plan.releaseBlocked}
          onClick={coreMaintenance.onRunRelease}
        >
          {busy === 'core'
            ? t('home2.common.working')
            : release.action === 'initial-install'
              ? t('core.installCore')
              // Naming the restart on the button is the disclosure: Home is
              // about to stop a Core the user is relying on.
              : plan.releaseRestartsCore
                ? t('home2.nodeCore.updateAndRestartCore')
                : t('updates.installUpdate')}
        </button>
      ) : null}
      {onOpenReleaseNotes && showRelease && release?.tag ? (
        <button
          type="button"
          className="home-v2-link-button"
          data-home-v2-node-core-action="core-release-notes"
          onClick={() => onOpenReleaseNotes({ product: 'core', tagName: release.tag! })}
        >
          {t('releaseNotes.open')}
        </button>
      ) : null}
      <CoreProgressBar progress={coreMaintenance.progress} />
    </>
  )
}

function coreLifecycleNotice({
  coreMaintenance,
  network,
  onChainCoreUpdates,
  qortalMaintenance,
}: {
  readonly coreMaintenance?: HomeV2CoreMaintenanceManagement
  readonly network: NetworkId
  readonly onChainCoreUpdates?: HomeV2OnChainCoreUpdates
  readonly qortalMaintenance?: HomeV2QortalMaintenanceManagement
}) {
  if (network === 'qortal') return qortalMaintenance?.notice ?? null
  if (coreLifecyclePlan(coreMaintenance, onChainCoreUpdates).releaseBlocked) {
    // 'unknown' is NOT 'running', and telling the user to stop a Core that
    // Home cannot see is how someone ends up stopping it repeatedly and being
    // told to stop it again. The install gate stays closed either way — that
    // conservatism is deliberate, because installing over a running Core
    // corrupts it — but the reason has to be truthful about which case it is.
    return coreMaintenance?.status?.core.runtime === 'unknown'
      ? t('home2.nodeCore.coreStateUnknown')
      : t('home2.nodeCore.stopCoreFirst')
  }
  return coreMaintenance?.notice ?? null
}

function TransportRow({
  transport,
}: {
  readonly transport: HomeV2TransportManagement
}) {
  const status = transport.status
  if (!status) {
    // A placeholder rather than nothing. Returning null here meant that while
    // the first status poll was in flight the I2P controls did not exist on the
    // page at all -- and on a slow poll that is indistinguishable from Home not
    // having them, which is what a tester reported. Say the row is loading
    // instead of implying it is absent.
    return (
      <div
        className="home-v2-node-core-row"
        data-home-v2-node-core-transport="loading"
        data-network="qortium"
      >
        <div className="home-v2-node-core-row__copy">
          <strong>{t('home2.transportMaintenance.title')}</strong>
          <small>{t('home2.common.loading')}</small>
        </div>
      </div>
    )
  }
  const blocked = transport.busy !== null || transport.stale
  return (
    <div
      className="home-v2-node-core-row"
      data-home-v2-node-core-transport="dashboard"
      data-network="qortium"
    >
      <div className="home-v2-node-core-row__copy">
        <strong>{t('home2.transportMaintenance.title')}</strong>
        <small id="node-core-transport-state">{routerStatusMessage(status)}</small>
      </div>
      <div className="home-v2-node-core-row__controls">
        {transport.mode && transport.onSetTransportMode ? (
          <select
            aria-label={t('home2.transportMaintenance.mode.label')}
            aria-describedby="node-core-transport-state"
            disabled={blocked || status.core.runtime !== 'stopped'}
            value={transport.mode}
            onChange={(event) =>
              transport.onSetTransportMode?.(
                event.target.value as HomeV2SettableTransportMode,
              )
            }
          >
            <option
              value="direct-and-i2p"
              disabled={!status.capabilities.canSetDirectAndI2p}
            >
              {t('home2.transportMaintenance.mode.directAndI2p')}
            </option>
            <option
              value="direct-only"
              disabled={!status.capabilities.canSetDirectOnly}
            >
              {t('home2.transportMaintenance.mode.directOnly')}
            </option>
            <option
              value="i2p-only"
              disabled={!status.capabilities.canSetI2pOnly}
            >
              {t('home2.transportMaintenance.mode.i2pOnly')}
            </option>
          </select>
        ) : null}
        {status.capabilities.canEnsureRouter && transport.onEnsureRouter ? (
          <button
            type="button"
            className="home-v2-secondary-button"
            aria-describedby="node-core-transport-state"
            data-home-v2-node-core-action="ensure-router"
            disabled={blocked}
            onClick={transport.onEnsureRouter}
          >
            {transport.busy === 'ensure-router'
              ? t('home2.common.working')
              : ensureLabel(status)}
          </button>
        ) : null}
        {status.capabilities.canStopRouter && transport.onStopRouter ? (
          <button
            type="button"
            className="home-v2-secondary-button"
            aria-describedby="node-core-transport-state"
            data-home-v2-node-core-action="stop-router"
            disabled={blocked}
            onClick={transport.onStopRouter}
          >
            {transport.busy === 'stop-router'
              ? t('home2.common.working')
              : t('home2.transportMaintenance.router.stop')}
          </button>
        ) : null}
        {status.capabilities.canRevealRouterFolder && transport.onRevealRouterFolder ? (
          // Opens the managed router's folder. Not disabled by `blocked`: that
          // guards operations that change the router, and opening a folder
          // changes nothing -- refusing it while the Core is busy would be
          // withholding something harmless.
          <button
            type="button"
            className="home-v2-secondary-button"
            data-home-v2-node-core-action="reveal-router"
            onClick={transport.onRevealRouterFolder}
          >
            {transport.busy === 'reveal-router'
              ? t('home2.common.working')
              : t('home2.transportMaintenance.router.reveal')}
          </button>
        ) : null}
      </div>
      {transport.notice ? (
        <p
          className="home-v2-core-notice"
          role={transport.notice.error ? 'alert' : 'status'}
        >
          {transport.notice.message}
        </p>
      ) : null}
    </div>
  )
}

/**
 * One compact Home-update row for the whole section. The policy and channel
 * controls stay in Settings; this is only check / download / open.
 */
function HomeUpdateRow({
  onOpenReleaseNotes,
  updates,
}: {
  readonly onOpenReleaseNotes?: (target: { product: 'core' | 'home'; tagName: string }) => void
  readonly updates: HomeV2AppUpdates
}) {
  const result = updates.result
  const busy = updates.busy !== null
  const canDownload = result?.state === 'available' &&
    !!result.asset?.digestAvailable && !updates.download
  return (
    <div
      className="home-v2-node-core-row"
      data-home-v2-node-core-home-update="dashboard"
    >
      <div className="home-v2-node-core-row__copy">
        <strong>{t('common.appName')}</strong>
        <small aria-live="polite" role="status">{homeUpdateStatusText(updates)}</small>
      </div>
      <div className="home-v2-node-core-row__controls">
        <button
          type="button"
          className="home-v2-secondary-button"
          data-home-v2-node-core-action="home-check"
          disabled={busy || !updates.preferencesLoaded}
          onClick={() => void updates.check()}
        >
          {updates.busy === 'check' ? t('common.checking') : t('updates.checkForUpdates')}
        </button>
        {onOpenReleaseNotes && result?.release?.tagName ? (
          <button
            type="button"
            className="home-v2-link-button"
            data-home-v2-node-core-action="home-release-notes"
            onClick={() => onOpenReleaseNotes({
              product: 'home',
              tagName: result.release!.tagName,
            })}
          >
            {t('releaseNotes.open')}
          </button>
        ) : null}
        {canDownload ? (
          <button
            type="button"
            className="home-v2-primary-button"
            data-home-v2-node-core-action="home-download"
            disabled={busy}
            onClick={() => void updates.downloadUpdate()}
          >
            {updates.busy === 'download'
              ? t('common.downloading')
              : t('updates.downloadUpdate')}
          </button>
        ) : null}
        {updates.download?.canOpen ? (
          <button
            type="button"
            className="home-v2-primary-button"
            data-home-v2-node-core-action="home-open"
            disabled={busy}
            onClick={() => void updates.openDownloaded()}
          >
            {updates.isAndroid ? t('updates.installApk') : t('common.openFile')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The dashboard's single "Node & Core" section: one card per enabled network
 * carrying that network's connection, its Core lifecycle and — for Qortium —
 * its i2p transport, plus one Home-update row for the section.
 *
 * Every live value arrives through props. The maintenance controllers are
 * instantiated once in HomeV2LiveApp and reach this component as the optional
 * slices on `coreManagement`, which keeps this file renderable from a fixture.
 */
export function HomeV2NodeCoreSection({
  appUpdates,
  coreManagement,
  networks,
  onChainCoreUpdates,
  onConfigureCustomNode,
  onOpenCoreDocs,
  onOpenReleaseNotes,
  onOpenSettings,
  onRefreshNode,
  onSetNodeMode,
  snapshot,
}: HomeV2NodeCoreSectionProps) {
  if (networks.length === 0) return null
  const coreAvailable = !!coreManagement?.available
  return (
    <section className="home-v2-node-core" aria-labelledby="node-core-title">
      <div className="home-v2-section-heading">
        <div>
          <h2 id="node-core-title">{t('home2.nodeCore.title')}</h2>
          <p>{t('home2.nodeCore.description')}</p>
        </div>
        {onOpenSettings ? (
          <button
            type="button"
            className="home-v2-link-button"
            aria-label={`${t('common.settings')}: ${t('home2.nodeCore.title')}`}
            onClick={onOpenSettings}
          >
            {t('common.settings')}
          </button>
        ) : null}
      </div>
      <div className="home-v2-node-core-grid">
        {networks.map((network) => {
          const lifecycle: ReactNode = coreAvailable ? (
            <CoreLifecycleActions
              coreMaintenance={coreManagement?.coreMaintenance}
              network={network}
              onChainCoreUpdates={onChainCoreUpdates}
              onOpenReleaseNotes={onOpenReleaseNotes}
              qortalMaintenance={coreManagement?.qortalMaintenance}
            />
          ) : null
          return (
            <article
              key={network}
              className="home-v2-node-core-card"
              data-network={network}
            >
              <NodeConnection
                snapshot={snapshot}
                network={network}
                onSetNodeMode={onSetNodeMode}
                onRefreshNode={onRefreshNode}
                onConfigureCustomNode={onConfigureCustomNode}
                onOpenCoreDocs={onOpenCoreDocs}
              />
              {coreAvailable && coreManagement ? (
                <CoreManagerCard
                  installedVersion={network === 'qortium'
                    ? coreManagement.coreMaintenance?.status?.core.installedVersion ?? null
                    : coreManagement.qortalMaintenance?.status?.installedVersion ?? null}
                  management={coreManagement}
                  network={network}
                  maintenanceActions={lifecycle}
                  maintenanceNotice={coreLifecycleNotice({
                    coreMaintenance: coreManagement.coreMaintenance,
                    network,
                    onChainCoreUpdates,
                    qortalMaintenance: coreManagement.qortalMaintenance,
                  })}
                />
              ) : null}
              {coreAvailable && network === 'qortium' && coreManagement?.transport ? (
                <TransportRow transport={coreManagement.transport} />
              ) : null}
            </article>
          )
        })}
      </div>
      {appUpdates?.available
        ? <HomeUpdateRow onOpenReleaseNotes={onOpenReleaseNotes} updates={appUpdates} />
        : null}
    </section>
  )
}
