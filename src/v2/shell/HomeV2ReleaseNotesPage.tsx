import { ReleaseNotesPage } from '../../ReleaseNotesPage'
import { getHomeV2ReleaseNotesSource } from '../../home-v2-live/release-notes-client'

export type HomeV2ReleaseNotesTarget = {
  readonly product: 'core' | 'home'
  readonly tagName: string
}

export function HomeV2ReleaseNotesPage({
  onNavigate,
  target,
}: {
  readonly onNavigate: (target: HomeV2ReleaseNotesTarget) => void
  readonly target: HomeV2ReleaseNotesTarget
}) {
  return (
    <ReleaseNotesPage
      route={{
        displayUrl: `home://releases/${target.product}/${encodeURIComponent(target.tagName)}`,
        kind: 'release-notes',
        product: target.product,
        tagName: target.tagName,
      }}
      source={getHomeV2ReleaseNotesSource()}
      onOpenReleaseNotes={(product, tagName) => onNavigate({ product, tagName })}
    />
  )
}
