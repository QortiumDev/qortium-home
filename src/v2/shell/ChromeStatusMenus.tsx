import type { ReactNode } from 'react'
import { t } from '../../i18n'
import type {
  DualIdentityLookupResult,
  HomeV2Snapshot,
  NetworkId,
  VisibleAvatarLoader,
} from '../contracts'
import { networkLabels } from './NetworkBadge'
import { NetworkMark } from './ProductMarks'
import { VisibleIdentityAvatar } from './VisibleIdentityAvatar'
import { useDismissablePopover } from './useDismissablePopover'

const nodeModeLabelKeys = {
  custom: 'home2.node.mode.custom',
  disabled: 'home2.node.mode.disabled',
  local: 'home2.node.mode.local',
  public: 'home2.node.mode.public',
} as const

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
  ].filter(Boolean)
  return parts.join(' · ') || t('home2.node.waitingForStatus')
}

interface ChromeMenuProps {
  readonly children: ReactNode
  readonly label: string
  readonly trigger: (props: {
    readonly onClick: () => void
    readonly 'aria-expanded': boolean
    readonly 'aria-haspopup': 'menu'
  }) => ReactNode
}

function ChromeMenu({ children, label, trigger }: ChromeMenuProps) {
  const { containerRef, open, setOpen } = useDismissablePopover<HTMLDivElement>()
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
          {children}
        </div>
      ) : null}
    </div>
  )
}

export interface NodeStatusMenuProps {
  readonly network: NetworkId
  readonly node: HomeV2Snapshot['nodes'][NetworkId]
  readonly tone: string
  readonly onOpenDashboard?: () => void
}

/**
 * The toolbar network button. It used to jump straight to the Dashboard, which
 * threw away whatever the user was looking at just to read a status line; it
 * now shows that status in place (owner request).
 */
export function NodeStatusMenu({
  network,
  node,
  tone,
  onOpenDashboard,
}: NodeStatusMenuProps) {
  const summary = `${networkLabels[network]}: ${node.statusText}`
  return (
    <ChromeMenu
      label={t('home2.node.connectionTitle', { network: networkLabels[network] })}
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
      <strong>{networkLabels[network]}</strong>
      <span>{node.statusText}</span>
      <small>
        {node.mode === 'disabled'
          ? t('home2.node.noConnection')
          : `${t(nodeModeLabelKeys[node.mode])} · ${node.label}`}
      </small>
      <small>{nodeMetrics(node)}</small>
      {node.localCoreStatusText ? <small>{node.localCoreStatusText}</small> : null}
      {onOpenDashboard ? (
        <button type="button" role="menuitem" onClick={onOpenDashboard}>
          {t('common.dashboard')}
        </button>
      ) : null}
    </ChromeMenu>
  )
}

export interface AccountStatusMenuProps {
  readonly snapshot: HomeV2Snapshot
  readonly selectedAccountLookup?: DualIdentityLookupResult | null
  readonly loadVisibleAvatar?: VisibleAvatarLoader
  readonly onOpenDashboard?: () => void
  readonly onLockAccount?: () => void
  readonly onUnlockAccount?: () => void
}

/**
 * The toolbar account button, which likewise navigated away rather than
 * answering "who am I signed in as, and on which chains".
 */
export function AccountStatusMenu({
  snapshot,
  selectedAccountLookup,
  loadVisibleAvatar,
  onOpenDashboard,
  onLockAccount,
  onUnlockAccount,
}: AccountStatusMenuProps) {
  const hasAccount = snapshot.account.state !== 'none'
  const isLocked = snapshot.account.state === 'locked'
  const label = !hasAccount
    ? t('account.noAccount')
    : isLocked
      ? `${snapshot.identity.displayLabel} · ${t('account.statusLocked')}`
      : snapshot.identity.displayLabel
  const networks = (['qortium', 'qortal'] as const).filter(
    (network) => snapshot.nodes[network].mode !== 'disabled',
  )
  return (
    <ChromeMenu
      label={t('home2.account.selected')}
      trigger={(triggerProps) => (
        <button
          {...triggerProps}
          type="button"
          className="home-v2-account-button"
          data-account-state={snapshot.account.state}
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
          {label}
        </button>
      )}
    >
      <strong>{label}</strong>
      {hasAccount
        ? networks.map((network) => {
            const presence = snapshot.identity.presences[network]
            return (
              <small key={network} data-network={network}>
                {networkLabels[network]}
                {presence?.primaryName ? ` · ${presence.primaryName}` : ''}
                {presence?.address ? ` · ${presence.address}` : ''}
              </small>
            )
          })
        : null}
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
      {onOpenDashboard ? (
        <button type="button" role="menuitem" onClick={onOpenDashboard}>
          {t('common.dashboard')}
        </button>
      ) : null}
    </ChromeMenu>
  )
}
