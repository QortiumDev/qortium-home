import type { NetworkId } from '../contracts'
import { NetworkMark } from './ProductMarks'

export const networkLabels: Readonly<Record<NetworkId, string>> = {
  qortal: 'Qortal',
  qortium: 'Qortium',
}

export function NetworkBadge({
  compact = false,
  network,
}: {
  /** Icon only, no frame or text — for dense places like the tab strip. */
  readonly compact?: boolean
  readonly network: NetworkId
}) {
  if (compact) {
    return (
      <span
        className={`home-v2-network home-v2-network--compact home-v2-network--${network}`}
        // The label is dropped visually, so it has to survive for assistive
        // technology and as a tooltip.
        aria-label={networkLabels[network]}
        title={networkLabels[network]}
        role="img"
      >
        <NetworkMark network={network} />
      </span>
    )
  }
  return (
    <span className={`home-v2-network home-v2-network--${network}`}>
      <NetworkMark network={network} />
      <span>{networkLabels[network]}</span>
    </span>
  )
}
