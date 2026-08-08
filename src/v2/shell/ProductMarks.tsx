import type { CSSProperties } from 'react'
import type { NetworkId } from '../contracts'

const homeMarkUrl = new URL(
  '../../assets/icons/qortium-home-protoicon-thick-interior.png',
  import.meta.url,
).href
const qortalMaskUrl = new URL(
  '../assets/marks/qortal-from-qortium-color-mask.svg',
  import.meta.url,
).href
const qortiumMaskUrl = new URL(
  '../assets/marks/qortium-protoicon-color-mask.webp',
  import.meta.url,
).href

function classNames(base: string, className?: string): string {
  return className ? `${base} ${className}` : base
}

export function HomeMark({ className }: { readonly className?: string }) {
  return (
    <span
      className={classNames('home-v2-home-mark', className)}
      aria-hidden="true"
    >
      <img src={homeMarkUrl} alt="" decoding="async" />
    </span>
  )
}

const networkMaskUrls: Readonly<Record<NetworkId, string>> = {
  qortal: qortalMaskUrl,
  qortium: qortiumMaskUrl,
}

export function NetworkMark({
  network,
  className,
}: {
  readonly network: NetworkId
  readonly className?: string
}) {
  return (
    <span
      className={classNames('home-v2-network-mark', className)}
      data-network-mark={network}
      aria-hidden="true"
      style={
        {
          '--v2-network-mark-image': `url("${networkMaskUrls[network]}")`,
        } as CSSProperties
      }
    />
  )
}
