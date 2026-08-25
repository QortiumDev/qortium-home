import type { ReactNode } from 'react'
import { Lock, LockOpen } from 'lucide-react'
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
}

/**
 * The toolbar network button. It used to jump straight to the Dashboard, which
 * threw away whatever the user was looking at just to read a status line; it
 * now shows that status in place (owner request).
 */
export function NodeStatusMenu({ network, node, tone }: NodeStatusMenuProps) {
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
    </ChromeMenu>
  )
}

export interface AccountStatusMenuProps {
  readonly snapshot: HomeV2Snapshot
  readonly selectedAccountLookup?: DualIdentityLookupResult | null
  readonly loadVisibleAvatar?: VisibleAvatarLoader
  readonly onLockAccount?: () => void
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
