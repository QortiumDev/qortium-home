import type { ReactNode } from 'react'
import type { HomeV2AppUpdates } from '../../home-v2-live/app-update-controller'
import type { HomeV2CoreMaintenanceManagement } from '../../home-v2-live/core-maintenance-controller'
import type { HomeV2OnChainCoreUpdates } from '../../home-v2-live/on-chain-core-update-controller'
import type { HomeV2QortalMaintenanceManagement } from '../../home-v2-live/qortal-maintenance-controller'
import type { HomeV2TransportManagement } from '../../home-v2-live/transport-maintenance-controller'
import { t, type TranslationKey } from '../../i18n'
import type {
  HomeV2Snapshot,
  NetworkId,
  NodeConnectionMode,
} from '../contracts'
import { deriveI2pCoreHealth, type I2pCorePlaneHealth } from '../i2p-health'
import { coreReleaseGate } from '../../home-v2-live/core-release-offer'
import { useCoreLifecycleControl, type HomeV2CoreManagement } from './CoreManagerCards'
import { HomeV2SectionToggle } from './HomeV2Prototype'
import { useScopedIds } from './dom-ids'
import { homeUpdateStatusText } from './HomeUpdateSettings'
import { NetworkBadge, networkLabels } from './NetworkBadge'
import { ensureLabel } from './TransportMaintenancePanel'

const nodeModeLabelKeys: Readonly<Record<NodeConnectionMode, TranslationKey>> = {
  disabled: 'home2.node.mode.disabled',
  local: 'home2.node.mode.local',
  public: 'home2.node.mode.public',
  custom: 'home2.node.mode.custom',
}

function i2pHealthStateLabel(value: I2pCorePlaneHealth['session']) {
  if (value === 'up') return t('common.ready')
  if (value === 'down') return t('common.unavailable')
  return t('common.unknown')
}

function i2pLeaseSetLabel(value: I2pCorePlaneHealth['leaseSet']) {
  if (value === 'resolved') return t('common.ready')
  if (value === 'not-resolved') return t('common.unavailable')
  return t('common.unknown')
}

function i2pPlaneText(
  planeName: 'chain' | 'data',
  plane: I2pCorePlaneHealth,
) {
  if (plane.conflict) return t('home2.node.waitingForStatus')
  const peers = plane.peerCount === null
    ? t('common.unknown')
    : planeName === 'chain'
      ? t('home2.node.peers', { count: plane.peerCount })
      : t('home2.node.dataPeers', { count: plane.peerCount })
  const timestamp = plane.lastInboundHandshakeTimestamp
  const inbound = timestamp !== null && Number.isSafeInteger(timestamp) && timestamp >= 0
    ? new Date(timestamp).toLocaleString()
    : t('common.unknown')
  const leaseSetTimestamp = plane.leaseSetLookupTimestamp
  const leaseSetAt = leaseSetTimestamp !== null && Number.isSafeInteger(leaseSetTimestamp) &&
    leaseSetTimestamp >= 0
    ? new Date(leaseSetTimestamp).toLocaleString()
    : t('common.unknown')
  return t('home2.node.i2pCorePlane', {
    inbound,
    leaseSet: i2pLeaseSetLabel(plane.leaseSet),
    leaseSetAt,
    peers,
    plane: planeName,
    session: i2pHealthStateLabel(plane.session),
  })
}

/**
 * The Qortium node's I2P chain/data plane health. Settings' Qortium block
 * shows it beside the transport panel; the dashboard row no longer does.
 */
export function I2pCoreHealthDetails({ node }: { readonly node: HomeV2Snapshot['nodes']['qortium'] }) {
  if (node.mode === 'disabled' || (node.state !== 'online' && node.state !== 'syncing') || node.error) {
    return null
  }
  const health = deriveI2pCoreHealth(node)
  return (
    <div className="home-v2-i2p-health" data-home-v2-i2p-health>
      <strong>{t('connections.activityLabel')}</strong>
      {health.reported ? (
        <>
          <small data-home-v2-i2p-health-plane="chain">{i2pPlaneText('chain', health.chain)}</small>
          <small data-home-v2-i2p-health-plane="data">{i2pPlaneText('data', health.data)}</small>
        </>
      ) : <small>{t('home2.node.waitingForStatus')}</small>}
    </div>
  )
}

export interface HomeV2NodeCoreSectionProps {
  /** Opens the release-notes page for a product. Absent = no links shown. */
  readonly onOpenReleaseNotes?: (target: { product: 'core' | 'home'; tagName: string }) => void
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
  /** Folded to the header line. Absent = never foldable. */
  readonly collapsed?: boolean
  readonly onToggleCollapsed?: () => void
}

/**
 * The connection-mode select, shared by the dashboard row and Settings'
 * per-network block so the two can never offer different modes.
 */
export function NodeModeSelect({
  node,
  network,
  onSetNodeMode,
}: {
  readonly node: Pick<HomeV2Snapshot['nodes'][NetworkId], 'mode'> & {
    readonly customConfigured?: boolean
  }
  readonly network: NetworkId
  readonly onSetNodeMode?: HomeV2NodeCoreSectionProps['onSetNodeMode']
}) {
  return (
    <select
      aria-label={t('home2.node.connectionModeFor', {
        network: networkLabels[network],
      })}
      value={node.mode}
      disabled={!onSetNodeMode}
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
  )
}

/**
 * The chain height, or the node's error. The peer breakdown (direct / I2P,
 * chain / data) is deliberately not here: the Node app, the toolbar's node
 * status menu and Settings all carry it, and on the dashboard it was noise.
 */
function nodeDetailText(node: HomeV2Snapshot['nodes'][NetworkId]) {
  if (node.mode === 'disabled') return t('home2.node.noConnection')
  if (node.error) return node.error
  return node.height === null
    ? t('home2.node.waitingForStatus')
    : t('home2.node.height', { height: node.height.toLocaleString() })
}

/**
 * One network, one line: chip, status, the connection mode, height and peers.
 * Everything else the old card carried -- the URL, the API docs link,
 * Configure, Refresh, the I2P plane health -- is configuration, and lives in
 * Settings > Runtime. The `home-v2-node-card` class stays on the line so the
 * network-order and enabled-network checks keep reading it.
 */
function NodeConnectionLine({
  snapshot,
  network,
  onSetNodeMode,
}: {
  readonly snapshot: HomeV2Snapshot
  readonly network: NetworkId
  readonly onSetNodeMode?: HomeV2NodeCoreSectionProps['onSetNodeMode']
}) {
  const node = snapshot.nodes[network]
  return (
    <div className="home-v2-node-card" data-network={network}>
      <span className="home-v2-node-card__network">
        <NetworkBadge network={network} />
      </span>
      <span className="home-v2-node-state" data-node-state={node.state}>
        <span className="home-v2-status-dot" aria-hidden="true" />
        {node.statusText}
      </span>
      <label className="home-v2-node-mode-control">
        <span>{t('home2.node.connectionMode')}</span>
        <NodeModeSelect node={node} network={network} onSetNodeMode={onSetNodeMode} />
      </label>
      <small className="home-v2-node-card__detail">{nodeDetailText(node)}</small>
    </div>
  )
}

/**
 * The Core half of a network's row: runtime state and installed version on
 * the left, the lifecycle plan's action and Start/Stop on the right. Built on
 * the same control hook as the Settings card, so the api-only stop
 * confirmation and the busy gating are identical.
 */
function CoreLine({
  channel,
  installedVersion,
  lifecycle,
  management,
  maintenanceNotice,
  network,
}: {
  readonly channel: string | null
  readonly installedVersion: string | null
  readonly lifecycle: ReactNode
  readonly management: HomeV2CoreManagement
  readonly maintenanceNotice: string | null
  readonly network: NetworkId
}) {
  const {
    busy,
    busyAction,
    cancelStop,
    confirmApiStop,
    invokeAction,
    requestStop,
    startBusy,
    status,
  } = useCoreLifecycleControl(management, network)
  return (
    <div
      className="home-v2-core-card home-v2-core-line"
      data-network={network}
      data-runtime={status.runtime}
      data-control={status.control}
    >
      <span className="home-v2-core-runtime" data-runtime={status.runtime}>
        <span className="home-v2-status-dot" aria-hidden="true" />
        {networkLabels[network]} Core
        {' · '}
        {status.runtime === 'running'
          ? t('core.runtimeRunning')
          : status.runtime === 'stopped'
            ? t('common.stopped')
            : t('common.unavailable')}
      </span>
      {installedVersion ? (
        <small
          className="home-v2-core-line__version"
          data-home-v2-core-version={installedVersion}
          data-home-v2-core-channel={channel ?? undefined}
        >
          {t('home2.core.installedVersion', { version: installedVersion })}
        </small>
      ) : null}
      <span className="home-v2-core-line__actions">
        {lifecycle}
        {status.capabilities.canStart ? (
          <button
            type="button"
            className="home-v2-primary-button"
            disabled={busy || startBusy}
            onClick={() => invokeAction('start')}
          >
            {busyAction === 'start' ? t('common.starting') : t('core.startCore')}
          </button>
        ) : status.capabilities.canStop ? (
          <button
            type="button"
            className="home-v2-secondary-button"
            disabled={busy}
            onClick={requestStop}
          >
            {busyAction === 'stop' ? t('common.stopping') : t('core.stopCore')}
          </button>
        ) : null}
      </span>
      {maintenanceNotice ? (
        <span className="home-v2-core-notice" role="status">{maintenanceNotice}</span>
      ) : null}
      {confirmApiStop ? (
        <div className="home-v2-core-confirm" role="alertdialog">
          <strong>
            {t('home2.core.confirmExternalTitle', { network: networkLabels[network] })}
          </strong>
          <p>{t('home2.core.confirmExternalBody')}</p>
          <div>
            <button autoFocus type="button" onClick={cancelStop}>
              {t('common.cancel')}
            </button>
            <button type="button" onClick={() => invokeAction('stop')}>
              {t('core.stopCore')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
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
  const showJava = !!status?.capabilities.canInstallJava
  const showOnChain = !showJava && !!onChainCoreUpdates?.canInstall
  // The offer that would actually install, from the same derivation the
  // mutation uses. Reading `release.action` here described the forward move on
  // the checked channel while `runCore()` installed the selected offer or the
  // newest stable, so this tile could label a downgrade "Update and restart
  // Core".
  const gate = coreReleaseGate(
    coreMaintenance?.release,
    coreMaintenance?.selectedReleaseTag,
    status,
  )
  // A downgrade is deliberately NOT offered here. It is a deliberate, confirmed
  // choice with its own release picker and confirmation prompt, and this
  // compact row has neither; Settings keeps it, under the stopped-only rule.
  const releaseOffer = gate.offer?.relation === 'downgrade' ? null : gate.offer
  const showRelease = !showJava && !showOnChain && !!releaseOffer
  return {
    showJava,
    showOnChain,
    showRelease,
    // Which release the button installs, so its label and the release-notes
    // link name the same build the mutation targets.
    releaseOffer: showRelease ? releaseOffer : null,
    // Home stops and restarts the Core itself; the button says so. Requires an
    // update, an observed 'running' runtime and the capability — all three.
    releaseRestartsCore: showRelease && gate.restartsCore,
    // A verified release Home cannot install yet needs the reason spelled out;
    // a disabled button on its own reads as a broken tile.
    releaseBlocked: showRelease && gate.blocked,
    releaseBlockedReason: showRelease ? gate.blockedReason : null,
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
  const { busy } = coreMaintenance
  const plan = coreLifecyclePlan(coreMaintenance, onChainCoreUpdates)
  const { releaseOffer, showJava, showOnChain, showRelease } = plan
  return (
    <>
      {!showRelease && coreMaintenance.onCheckRelease ? (
        <button
          type="button"
          className="home-v2-link-button"
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
      {releaseOffer && coreMaintenance.onRunRelease ? (
        <button
          type="button"
          className="home-v2-primary-button"
          data-home-v2-node-core-action="core-release"
          data-home-v2-core-release-target={releaseOffer.tag}
          disabled={busy !== null || plan.releaseBlocked}
          onClick={coreMaintenance.onRunRelease}
        >
          {busy === 'core'
            ? t('home2.common.working')
            : releaseOffer.relation === 'initial-install'
              ? t('core.installCore')
              // Naming the restart on the button is the disclosure: Home is
              // about to stop a Core the user is relying on.
              : plan.releaseRestartsCore
                ? t('home2.nodeCore.updateAndRestartCore')
                : t('updates.installUpdate')}
        </button>
      ) : null}
      {onOpenReleaseNotes && releaseOffer ? (
        <button
          type="button"
          className="home-v2-link-button"
          data-home-v2-node-core-action="core-release-notes"
          onClick={() => onOpenReleaseNotes({ product: 'core', tagName: releaseOffer.tag })}
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
  const plan = coreLifecyclePlan(coreMaintenance, onChainCoreUpdates)
  if (plan.releaseBlocked) {
    // 'unknown' is NOT 'running', and telling the user to stop a Core that
    // Home cannot see is how someone ends up stopping it repeatedly and being
    // told to stop it again. The install gate stays closed either way — that
    // conservatism is deliberate, because installing over a running Core
    // corrupts it — but the reason has to be truthful about which case it is.
    return plan.releaseBlockedReason === 'core-state-unknown'
      ? t('home2.nodeCore.coreStateUnknown')
      : t('home2.nodeCore.stopCoreFirst')
  }
  return coreMaintenance?.notice ?? null
}

/**
 * The Home tile's body: version and update state on the left, the release
 * channel, check, install folder, release notes and download / open on the
 * right. The update policy and the byte-level details stay in Settings.
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
        {result?.currentVersion ? (
          // WHICH Home is installed. 1.x put its own version on the dashboard;
          // Home 2 showed only an update state, so "up to date" never said up
          // to date at WHAT. The section heading names Home, so the row leads
          // with the version.
          <strong data-home-v2-home-version={result.currentVersion}>
            {t('home2.core.installedVersion', { version: result.currentVersion })}
          </strong>
        ) : (
          <strong>{t('common.appName')}</strong>
        )}
        <small aria-live="polite" role="status">{homeUpdateStatusText(updates)}</small>
      </div>
      <div className="home-v2-node-core-row__controls">
        {/* The release channel and the install folder used to be Settings-
            only; the tile now carries the same controls as its Settings
            block, minus the policy and the byte-level details. */}
        <select
          aria-label={t('updates.releaseChannelLabel')}
          data-home-v2-node-core-action="home-channel"
          disabled={busy || !updates.preferencesLoaded}
          value={updates.channel}
          onChange={(event) =>
            updates.setChannel(event.target.value as 'prerelease' | 'stable')}
        >
          <option value="stable">{t('updates.channelStable')}</option>
          <option value="prerelease">{t('updates.channelPrerelease')}</option>
        </select>
        <button
          type="button"
          className="home-v2-secondary-button"
          data-home-v2-node-core-action="home-check"
          disabled={busy || !updates.preferencesLoaded}
          onClick={() => void updates.check()}
        >
          {updates.busy === 'check' ? t('common.checking') : t('updates.checkForUpdates')}
        </button>
        {!updates.isAndroid && updates.canRevealInstallFolder ? (
          <button
            type="button"
            className="home-v2-secondary-button"
            data-home-v2-node-core-action="home-install-folder"
            disabled={busy}
            onClick={() => void updates.revealInstallFolder()}
          >
            {t('updates.showInstallFolder')}
          </button>
        ) : null}
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
        {updates.isAndroid && updates.download?.canOpen ? (
          <button
            type="button"
            className="home-v2-primary-button"
            data-home-v2-node-core-action="home-open"
            disabled={busy}
            onClick={() => void updates.openDownloaded()}
          >
            {t('updates.installApk')}
          </button>
        ) : null}
        {!updates.isAndroid && updates.canInstall ? (
          <button
            type="button"
            className="home-v2-primary-button"
            data-home-v2-node-core-action="home-install"
            data-home-v2-update-install-kind={updates.installKind ?? undefined}
            disabled={busy}
            onClick={() => void updates.installDownloaded()}
          >
            {updates.busy === 'install'
              ? t('common.installing')
              : updates.installKind === 'disk-image'
                ? t('updates.openDiskImage')
                : t('updates.installAndRestart')}
          </button>
        ) : null}
      </div>
      {/* A download the reader started from here has to be visible from here.
          The full byte counts stay in Settings; this is the same compact bar
          the Core rows use, so the section reads as one thing. */}
      <CoreProgressBar
        progress={updates.progress
          ? {
              action: updates.progress.action,
              kind: 'home',
              message: updates.progress.message,
              percent: updates.progress.percent,
            }
          : null}
      />
    </div>
  )
}

/**
 * The dashboard's single "Node & Core" section: one card per enabled network
 * carrying that network's connection, its Core lifecycle and — for Qortium —
 * its i2p transport. Home's own update row is HomeV2HomeSection below.
 *
 * Every live value arrives through props. The maintenance controllers are
 * instantiated once in HomeV2LiveApp and reach this component as the optional
 * slices on `coreManagement`, which keeps this file renderable from a fixture.
 */
/**
 * The I2P router half of the Qortium row: state and installed version, with
 * the basic management -- install-and-start / start, stop, update-and-restart
 * -- so the router can be looked after from the dashboard. The transport
 * mode, its Apply/restart flow and the router folder stay in Settings.
 * Shares the transport controller with Settings, so busy and notice agree.
 */
function TransportLine({ transport }: { readonly transport: HomeV2TransportManagement }) {
  const status = transport.status
  if (!status) {
    // The row exists while the first poll is in flight; returning nothing
    // here read as Home not having I2P at all on a slow poll.
    return (
      <div className="home-v2-transport-line" data-home-v2-node-core-transport="loading">
        <span className="home-v2-core-runtime" data-runtime="unknown">
          <span className="home-v2-status-dot" aria-hidden="true" />
          {t('connections.routerLabel')}
        </span>
        <small className="home-v2-core-line__version">{t('home2.common.loading')}</small>
      </div>
    )
  }
  const routerRunning = status.router.state === 'managed-running' || status.router.state === 'external-running'
  const routerWord = routerRunning
    ? t('core.runtimeRunning')
    : status.router.state === 'managed-stopped'
      ? t('common.stopped')
      : status.router.state === 'missing'
        ? t('common.notInstalled')
        : t('common.unavailable')
  const blocked = transport.busy !== null || transport.stale
  return (
    <div
      className="home-v2-transport-line"
      data-home-v2-node-core-transport="dashboard"
      data-network="qortium"
      data-router-state={status.router.state}
    >
      <span className="home-v2-core-runtime" data-runtime={routerRunning ? 'running' : 'stopped'}>
        <span className="home-v2-status-dot" aria-hidden="true" />
        {t('connections.routerLabel')}
        {' · '}
        {routerWord}
      </span>
      {status.router.version ? (
        <small className="home-v2-core-line__version" data-home-v2-router-version={status.router.version}>
          {status.router.version}
        </small>
      ) : null}
      <span className="home-v2-core-line__actions">
        {status.capabilities.canEnsureRouter && transport.onEnsureRouter ? (
          <button
            type="button"
            className="home-v2-primary-button"
            data-home-v2-node-core-action="ensure-router"
            disabled={blocked}
            onClick={transport.onEnsureRouter}
          >
            {transport.busy === 'ensure-router' ? t('home2.common.working') : ensureLabel(status)}
          </button>
        ) : null}
        {status.capabilities.canStopRouter && transport.onStopRouter ? (
          <button
            type="button"
            className="home-v2-secondary-button"
            data-home-v2-node-core-action="stop-router"
            disabled={blocked}
            onClick={transport.onStopRouter}
          >
            {transport.busy === 'stop-router'
              ? t('home2.common.working')
              : t('home2.transportMaintenance.router.stop')}
          </button>
        ) : null}
        {status.router.maintenance === 'update' && transport.onUpdateRouter ? (
          <button
            type="button"
            className="home-v2-primary-button"
            data-home-v2-node-core-action="update-router"
            disabled={blocked || !status.capabilities.canUpdateRouter}
            onClick={transport.onUpdateRouter}
          >
            {transport.busy === 'update-router'
              ? t('home2.common.working')
              : t('home2.transportMaintenance.router.updateAndRestart')}
          </button>
        ) : null}
        <CoreProgressBar progress={transport.progress} />
      </span>
      {transport.notice ? (
        <span className="home-v2-core-notice" role={transport.notice.error ? 'alert' : 'status'}>
          {transport.notice.message}
        </span>
      ) : null}
    </div>
  )
}

export function HomeV2NodeCoreSection({
  coreManagement,
  networks,
  onChainCoreUpdates,
  onOpenReleaseNotes,
  onOpenSettings,
  onSetNodeMode,
  snapshot,
  collapsed = false,
  onToggleCollapsed,
}: HomeV2NodeCoreSectionProps) {
  const id = useScopedIds()
  if (networks.length === 0) return null
  const coreAvailable = !!coreManagement?.available
  const bodyId = id('node-core-body')
  return (
    <section
      className="home-v2-panel home-v2-node-core"
      aria-labelledby={id('node-core-title')}
      data-home-v2-node-core-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className="home-v2-section-heading">
        <h2 id={id('node-core-title')}>{t('home2.nodeCore.title')}</h2>
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
        {onToggleCollapsed ? (
          <HomeV2SectionToggle
            collapsed={collapsed}
            controls={bodyId}
            label={t('home2.nodeCore.title')}
            testId="data-home-v2-node-core-toggle"
            onToggle={onToggleCollapsed}
          />
        ) : null}
      </div>
      {collapsed ? null : (
      <div className="home-v2-node-core-grid" id={bodyId}>
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
              <NodeConnectionLine
                snapshot={snapshot}
                network={network}
                onSetNodeMode={onSetNodeMode}
              />
              {coreAvailable && coreManagement ? (
                <CoreLine
                  // Which BUILD, not just which version: two builds of one
                  // version are otherwise indistinguishable. Only Qortium
                  // reports a channel; the commit stays in Settings.
                  channel={network === 'qortium'
                    ? coreManagement.coreMaintenance?.status?.core.channel ?? null
                    : null}
                  installedVersion={network === 'qortium'
                    ? coreManagement.coreMaintenance?.status?.core.installedVersion ?? null
                    : coreManagement.qortalMaintenance?.status?.installedVersion ?? null}
                  lifecycle={lifecycle}
                  management={coreManagement}
                  maintenanceNotice={coreLifecycleNotice({
                    coreMaintenance: coreManagement.coreMaintenance,
                    network,
                    onChainCoreUpdates,
                    qortalMaintenance: coreManagement.qortalMaintenance,
                  })}
                  network={network}
                />
              ) : null}
              {coreAvailable && network === 'qortium' && coreManagement?.transport ? (
                <TransportLine transport={coreManagement.transport} />
              ) : null}
            </article>
          )
        })}
      </div>
      )}
    </section>
  )
}

/**
 * The dashboard's "Home" section: the installed Home version and its update
 * state. It depends on no network, so it lives outside Node & Core and is
 * drawn before the enabled networks are known.
 */
export function HomeV2HomeSection({
  appUpdates,
  onOpenReleaseNotes,
  onOpenSettings,
}: {
  readonly appUpdates: HomeV2AppUpdates
  readonly onOpenReleaseNotes?: (target: { product: 'core' | 'home'; tagName: string }) => void
  readonly onOpenSettings?: () => void
}) {
  const id = useScopedIds()
  return (
    <section className="home-v2-panel home-v2-home-section" aria-labelledby={id('home-title')}>
      <div className="home-v2-section-heading">
        <h2 id={id('home-title')}>{t('common.appName')}</h2>
        {onOpenSettings ? (
          <button
            type="button"
            className="home-v2-link-button"
            aria-label={`${t('common.settings')}: ${t('common.appName')}`}
            onClick={onOpenSettings}
          >
            {t('common.settings')}
          </button>
        ) : null}
      </div>
      <HomeUpdateRow onOpenReleaseNotes={onOpenReleaseNotes} updates={appUpdates} />
    </section>
  )
}
