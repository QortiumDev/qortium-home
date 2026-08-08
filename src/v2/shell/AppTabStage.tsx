import type { ProductState } from '../product-model'
import { NetworkBadge } from './NetworkBadge'

export function AppTabStage({
  productState,
}: {
  readonly productState: ProductState
}) {
  const tab = productState.tabs.find(
    (candidate) => candidate.id === productState.activeTabId,
  )
  if (!tab) return null

  return (
    <section className="home-v2-app-stage" aria-label={`${tab.title} fixture`}>
      <div className="home-v2-app-stage__icon" aria-hidden="true">
        {tab.title.slice(0, 1)}
      </div>
      <NetworkBadge network={tab.context.targetNetwork} />
      <h2>{tab.title}</h2>
      <p>App content is unavailable in this offline preview.</p>
      <code>{tab.context.appId}</code>
    </section>
  )
}
