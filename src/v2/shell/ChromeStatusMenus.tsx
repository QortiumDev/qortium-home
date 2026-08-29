import type { ReactNode } from 'react'
import { Lock, LockOpen } from 'lucide-react'
import { t, type TranslationKey } from '../../i18n'
import type {
  DualIdentityLookupResult,
  HomeV2Snapshot,
  NetworkId,
  NodeConnectionMode,
  VisibleAvatarLoader,
} from '../contracts'
import {
  useCoreLifecycleControl,
  type HomeV2CoreManagement,
} from './CoreManagerCards'
import { networkLabels } from './NetworkBadge'
import { NetworkMark } from './ProductMarks'
import { VisibleIdentityAvatar } from './VisibleIdentityAvatar'
import { useDismissablePopover } from './useDismissablePopover'

// Same order as the Dashboard's connection-mode select, so the two controls
// read identically wherever the user meets them first.
const nodeModeLabelKeys: Readonly<Record<NodeConnectionMode, TranslationKey>> = {
  disabled: 'home2.node.mode.disabled',
  local: 'home2.node.mode.local',
  public: 'home2.node.mode.public',
  custom: 'home2.node.mode.custom',
}

/** Height and peer count when the node has reported them, else why not. */
function nodeMetrics(node: HomeV2Snapshot['nodes'][NetworkId]): string {
  if (node.error) return node.error
  const parts = [
    node.height === null
      ? null
      : t('home2.node.height', { height: node.height.toLocaleString() }),
    node.peerCount === null
      ? null
      : t('home2.node.peers', { count: node.peerCount }),
    node.dataPeerCount === null
      ? null
      : t('home2.node.dataPeers', { count: node.dataPeerCount }),
  ].filter(Boolean)
  return parts.join(' · ') || t('home2.node.waitingForStatus')
}

interface ChromeMenuProps {
  /**
   * Static content, or a render function handed a `close` callback. Items that
   * take the user somewhere else — a dialog, another page — have to close the
   * popover behind them; controls that act in place (a mode select, start/stop,
   * an update button) deliberately do not, so their busy state stays readable.
   */
  readonly children: ReactNode | ((close: () => void) => ReactNode)
  readonly label: string
  /** Reports the menu's open state so the chrome can suspend the app view. */
  readonly onOpenChange?: (open: boolean) => void
  readonly trigger: (props: {
    readonly onClick: () => void
    readonly 'aria-expanded': boolean
    readonly 'aria-haspopup': 'menu'
  }) => ReactNode
}

function ChromeMenu({ children, label, onOpenChange, trigger }: ChromeMenuProps) {
  const { containerRef, open, setOpen } =
    useDismissablePopover<HTMLDivElement>(onOpenChange)
  return (
    <div className="home-v2-chrome-menu" ref={containerRef}>
      {trigger({
        'aria-expanded': open,
        'aria-haspopup': 'menu',
        onClick: () => setOpen((current) => !current),
      })}
      {open ? (
        <div
          aria-label={label}
          className="home-v2-chrome-menu__panel"
          role="menu"
        >
          {typeof children === 'function'
            ? children(() => setOpen(false))
            : children}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The one update affordance this menu offers, read from whichever maintenance
 * slice owns the network. It is deliberately thinner than the Settings panel:
 * a check while nothing is actionable, and a single install/update button once
 * something is. Java, the on-chain route and the update policies stay in
 * Settings, which the menu links to.
 */
interface NodeMenuMaintenance {
  readonly canCheck: boolean
  readonly checkBusy: boolean
  readonly checkDisabled: boolean
  readonly installBusy: boolean
  readonly installDisabled: boolean
  readonly installLabel: string
  readonly notice: string | null
  readonly showInstall: boolean
  readonly onCheck?: () => void
  readonly onInstall?: () => void
}

function nodeMenuMaintenance(
  management: HomeV2CoreManagement,
  network: NetworkId,
): NodeMenuMaintenance | null {
  if (network === 'qortal') {
    const maintenance = management.qortalMaintenance
    const status = maintenance?.status
    if (!maintenance || !status) return null
    const { busy, release } = maintenance
    return {
      canCheck: status.capabilities.canCheckRelease,
      checkBusy: busy === 'check',
      checkDisabled: busy !== null,
      installBusy: busy === 'action',
      installDisabled: busy !== null || !maintenance.actionAllowed,
      installLabel:
        release?.action === 'initial-install'
          ? t('home2.qortalMaintenance.install')
          : t('home2.qortalMaintenance.update'),
      notice: maintenance.notice,
      onCheck: maintenance.onCheckRelease,
      onInstall: maintenance.onRunRelease,
      showInstall: !!release?.tag && release.action !== 'none',
    }
  }
  const maintenance = management.coreMaintenance
  const status = maintenance?.status
  if (!maintenance || !status) return null
  const { busy, release } = maintenance
  const showInstall = !!release?.tag && release.action !== 'none'
  // Home replaces the jar in place, so it cannot install over a running Core.
  // A disabled button with no explanation reads as a broken menu.
  const blocked = showInstall && status.core.runtime !== 'stopped'
  return {
    canCheck: true,
    checkBusy: busy === 'check',
    checkDisabled: busy !== null,
    installBusy: busy === 'core',
    installDisabled: busy !== null || blocked,
    installLabel:
      release?.action === 'initial-install'
        ? t('core.installCore')
        : t('updates.installUpdate'),
    notice: blocked ? t('home2.nodeCore.stopCoreFirst') : maintenance.notice,
    onCheck: maintenance.onCheckRelease,
    onInstall: maintenance.onRunRelease,
    showInstall,
  }
}

/**
 * Start/stop plus the compact update affordance for one network's local Core.
 * Split out so the lifecycle hook is called unconditionally — the menu only
 * mounts this once it knows there is a Core manager to talk to.
 */
function NodeMenuCoreControls({
  management,
  network,
}: {
  readonly management: HomeV2CoreManagement
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
  const maintenance = nodeMenuMaintenance(management, network)
  const showInstall = !!maintenance?.showInstall && !!maintenance.onInstall
  // Which lifecycle button this Core's capabilities allow, published so a smoke
  // run can check the rendered button against the status without knowing what
  // state the machine's Core happens to be in.
  const lifecycle = status.capabilities.canStart
    ? 'start'
    : status.capabilities.canStop
      ? 'stop'
      : 'none'
  return (
    <div
      className="home-v2-node-menu-core"
      data-network={network}
      data-lifecycle={lifecycle}
    >
      <small className="home-v2-node-menu-core__title">
        {`${networkLabels[network]} Core`}
      </small>
      {confirmApiStop ? (
        // Borrowed wholesale from the Core card: Home only asks an externally
        // controlled Core to exit, so the user has to mean it.
        <div className="home-v2-node-menu-confirm" role="alertdialog">
          <small>
            {t('home2.core.confirmExternalTitle', {
              network: networkLabels[network],
            })}
          </small>
          <small>{t('home2.core.confirmExternalBody')}</small>
          <div className="home-v2-node-menu-core__actions">
            <button
              autoFocus
              type="button"
              data-home-v2-node-menu-action="stop-cancel"
              onClick={cancelStop}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              data-home-v2-node-menu-action="stop-confirm"
              onClick={() => invokeAction('stop')}
            >
              {t('core.stopCore')}
            </button>
          </div>
        </div>
      ) : (
        <div className="home-v2-node-menu-core__actions">
          {status.capabilities.canStart ? (
            <button
              type="button"
              data-home-v2-node-menu-action="start"
              disabled={busy || startBusy}
              onClick={() => invokeAction('start')}
            >
              {busyAction === 'start' ? t('common.starting') : t('core.startCore')}
            </button>
          ) : status.capabilities.canStop ? (
            <button
              type="button"
              data-home-v2-node-menu-action="stop"
              disabled={busy}
              onClick={requestStop}
            >
              {busyAction === 'stop' ? t('common.stopping') : t('core.stopCore')}
            </button>
          ) : null}
          {showInstall && maintenance ? (
            <button
              type="button"
              data-home-v2-node-menu-action="install"
              disabled={maintenance.installDisabled}
              onClick={maintenance.onInstall}
            >
              {maintenance.installBusy
                ? t('home2.common.working')
                : maintenance.installLabel}
            </button>
          ) : maintenance?.canCheck && maintenance.onCheck ? (
            <button
              type="button"
              data-home-v2-node-menu-action="check"
              disabled={maintenance.checkDisabled}
              onClick={maintenance.onCheck}
            >
              {maintenance.checkBusy
                ? t('common.checking')
                : t('updates.checkForUpdates')}
            </button>
          ) : null}
        </div>
      )}
      {maintenance?.notice ? (
        <small role="status">{maintenance.notice}</small>
      ) : null}
    </div>
  )
}

export interface NodeStatusMenuProps {
  readonly coreManagement?: HomeV2CoreManagement
  readonly network: NetworkId
  readonly node: HomeV2Snapshot['nodes'][NetworkId]
  readonly tone: string
  /** Reports the menu's open state so the chrome can suspend the app view. */
  readonly onOpenChange?: (open: boolean) => void
  readonly onConfigureCustomNode?: (network: NetworkId) => void
  readonly onOpenCoreSettings?: () => void
  readonly onSetNodeMode?: (
    network: NetworkId,
    mode: NodeConnectionMode,
  ) => void | Promise<void>
}

/**
 * The toolbar network button. It used to jump straight to the Dashboard, which
 * threw away whatever the user was looking at just to read a status line; it
 * now shows that status in place, and acts on it: switch connection mode,
 * start or stop the local Core, and check or install a Core update without
 * leaving the page (owner request).
 */
export function NodeStatusMenu({
  coreManagement,
  network,
  node,
  onConfigureCustomNode,
  onOpenChange,
  onOpenCoreSettings,
  onSetNodeMode,
  tone,
}: NodeStatusMenuProps) {
  const summary = `${networkLabels[network]}: ${node.statusText}`
  return (
    <ChromeMenu
      label={t('home2.node.connectionTitle', { network: networkLabels[network] })}
      onOpenChange={onOpenChange}
      trigger={(triggerProps) => (
        <button
          {...triggerProps}
          type="button"
          className="home-v2-node-pill"
          data-network={network}
          data-node-tone={tone}
          aria-label={summary}
          title={summary}
        >
          <NetworkMark network={network} />
          {/* The only glanceable status signal now the label is gone; the full
              text lives in the accessible name, the tooltip, and this menu. */}
          <span className="home-v2-status-dot" aria-hidden="true" />
        </button>
      )}
    >
      {(close) => (
        <>
          <strong>{networkLabels[network]}</strong>
          <span>{node.statusText}</span>
          <small>
            {node.mode === 'disabled'
              ? t('home2.node.noConnection')
              : `${t(nodeModeLabelKeys[node.mode])} · ${node.label}`}
          </small>
          <small>{nodeMetrics(node)}</small>
          {node.localCoreStatusText ? <small>{node.localCoreStatusText}</small> : null}
          {onSetNodeMode ? (
            <label className="home-v2-node-menu-mode">
              <small>{t('home2.node.connectionMode')}</small>
              <select
                aria-label={t('home2.node.connectionModeFor', {
                  network: networkLabels[network],
                })}
                data-home-v2-node-menu-mode={network}
                value={node.mode}
                onChange={(event) =>
                  void onSetNodeMode(
                    network,
                    event.target.value as NodeConnectionMode,
                  )
                }
              >
                {(Object.keys(nodeModeLabelKeys) as NodeConnectionMode[]).map(
                  (mode) => (
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
                  ),
                )}
              </select>
            </label>
          ) : null}
          {/* Custom is the one mode that cannot be chosen until it is set up, so
              the dialog that sets it up has to be reachable from here too. */}
          {onConfigureCustomNode ? (
            <button
              type="button"
              role="menuitem"
              data-home-v2-node-menu-action="configure"
              onClick={() => {
                close()
                onConfigureCustomNode(network)
              }}
            >
              {t('home2.node.configure')}
            </button>
          ) : null}
          {coreManagement?.available ? (
            <NodeMenuCoreControls management={coreManagement} network={network} />
          ) : null}
          {onOpenCoreSettings ? (
            <button
              type="button"
              role="menuitem"
              data-home-v2-node-menu-action="settings"
              aria-label={`${t('common.settings')}: ${t('home2.nodeCore.title')}`}
              onClick={() => {
                close()
                onOpenCoreSettings()
              }}
            >
              {t('common.settings')}
            </button>
          ) : null}
        </>
      )}
    </ChromeMenu>
  )
}

export interface AccountStatusMenuProps {
  readonly snapshot: HomeV2Snapshot
  readonly selectedAccountLookup?: DualIdentityLookupResult | null
  readonly loadVisibleAvatar?: VisibleAvatarLoader
  readonly onLockAccount?: () => void
  /** Reports the menu's open state so the chrome can suspend the app view. */
  readonly onOpenChange?: (open: boolean) => void
  readonly onUnlockAccount?: () => void
}

/**
 * The one address to print, when there is one. Both chains usually derive the
 * same address from a single key, and repeating it per network was the main
 * source of the old panel's clutter; `null` means they genuinely differ and
 * each network has to show its own.
 */
function sharedAccountAddress(
  snapshot: HomeV2Snapshot,
  networks: readonly NetworkId[],
  lookup?: DualIdentityLookupResult | null,
): string | null {
  if (lookup?.sharedAddress) return lookup.sharedAddress
  const addresses: string[] = []
  for (const network of networks) {
    const address = snapshot.identity.presences[network].address
    if (address) addresses.push(address)
  }
  if (addresses.length === 0) return null
  return addresses.every((address) => address === addresses[0])
    ? addresses[0]
    : null
}

/**
 * The toolbar account button, which likewise navigated away rather than
 * answering "who am I signed in as, and on which chains".
 */
export function AccountStatusMenu({
  snapshot,
  selectedAccountLookup,
  loadVisibleAvatar,
  onLockAccount,
  onOpenChange,
  onUnlockAccount,
}: AccountStatusMenuProps) {
  const hasAccount = snapshot.account.state !== 'none'
  const isLocked = snapshot.account.state === 'locked'
  const lockStateText = isLocked
    ? t('account.statusLocked')
    : t('account.statusUnlocked')
  // The trigger shows no text any more (owner request), so everything the old
  // label said has to survive as the button's accessible name and tooltip.
  const label = !hasAccount
    ? t('account.noAccount')
    : `${snapshot.identity.displayLabel} · ${lockStateText}`
  const networks = (['qortium', 'qortal'] as const).filter(
    (network) => snapshot.nodes[network].mode !== 'disabled',
  )
  const sharedAddress = hasAccount
    ? sharedAccountAddress(snapshot, networks, selectedAccountLookup)
    : null
  const LockGlyph = isLocked ? Lock : LockOpen
  return (
    <ChromeMenu
      label={t('home2.account.selected')}
      onOpenChange={onOpenChange}
      trigger={(triggerProps) => (
        <button
          {...triggerProps}
          type="button"
          className="home-v2-account-button"
          data-account-state={snapshot.account.state}
          aria-label={label}
          title={label}
        >
          {!hasAccount ? (
            <span aria-hidden="true">+</span>
          ) : selectedAccountLookup ? (
            <span className="home-v2-account-avatars" aria-hidden="true">
              {networks.map((network) => (
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
          {hasAccount ? (
            <LockGlyph
              aria-hidden="true"
              className="home-v2-account-lock"
              data-account-state={snapshot.account.state}
              size={14}
              strokeWidth={2.25}
            />
          ) : null}
        </button>
      )}
    >
      <strong>
        {hasAccount ? snapshot.identity.displayLabel : t('account.noAccount')}
      </strong>
      {hasAccount ? (
        <>
          {networks.map((network) => {
            const presence = snapshot.identity.presences[network]
            return (
              <div
                className="home-v2-account-detail"
                data-network={network}
                key={network}
              >
                <small className="home-v2-account-detail__label">
                  {networkLabels[network]}
                </small>
                <span className="home-v2-account-detail__value">
                  {presence.primaryName ?? t('home2.identity.noRegisteredName')}
                </span>
                {/* Only when the chains disagree; the shared case prints once
                    below instead of repeating the same string per network. */}
                {!sharedAddress && presence.address ? (
                  <code className="home-v2-account-detail__address">
                    {presence.address}
                  </code>
                ) : null}
              </div>
            )
          })}
          {sharedAddress ? (
            <div className="home-v2-account-detail">
              <small className="home-v2-account-detail__label">
                {t('home2.account.selectedAddress')}
              </small>
              <code className="home-v2-account-detail__address">
                {sharedAddress}
              </code>
            </div>
          ) : null}
          <div
            className="home-v2-account-detail home-v2-account-detail--state"
            data-account-state={snapshot.account.state}
          >
            <LockGlyph aria-hidden="true" size={13} strokeWidth={2.25} />
            <span className="home-v2-account-detail__value">
              {lockStateText}
            </span>
          </div>
        </>
      ) : null}
      {hasAccount && isLocked && onUnlockAccount ? (
        <button type="button" role="menuitem" onClick={onUnlockAccount}>
          {t('home2.account.unlock')}
        </button>
      ) : null}
      {hasAccount && !isLocked && onLockAccount ? (
        <button type="button" role="menuitem" onClick={onLockAccount}>
          {t('home2.account.lock')}
        </button>
      ) : null}
    </ChromeMenu>
  )
}
