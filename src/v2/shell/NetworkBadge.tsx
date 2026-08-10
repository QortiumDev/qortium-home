import type { NetworkId } from '../contracts'
import { NetworkMark } from './ProductMarks'

export const networkLabels: Readonly<Record<NetworkId, string>> = {
  qortal: 'Qortal',
  qortium: 'Qortium',
}

export function NetworkBadge({
  network,
}: {
  readonly network: NetworkId
}) {
  return (
    <span className={`home-v2-network home-v2-network--${network}`}>
      <NetworkMark network={network} />
      <span>{networkLabels[network]}</span>
    </span>
  )
}
