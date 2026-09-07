import type {
  HomeV2CoreMaintenanceRelease,
  HomeV2CoreMaintenanceStatus,
  HomeV2CoreReleaseOffer,
} from './core-manager-client'

/**
 * Which release an install button would actually install.
 *
 * `release.action` describes ONE thing: the forward move on the channel that
 * was checked. `runCore()` installs something else — the offer the user picked,
 * or `offers[0]` — so a surface that labels and gates on `action` can promise an
 * update and run a downgrade. An installed prerelease is the reachable case:
 * stable is then a downgrade and sits first in the list, while `action` still
 * reads 'strict-update' for the newer prerelease.
 *
 * One derivation, used by every surface AND by the mutation, is the only way
 * those three can stay in agreement.
 */
export function effectiveCoreReleaseOffer(
  release: HomeV2CoreMaintenanceRelease | null | undefined,
  selectedReleaseTag?: string | null,
): HomeV2CoreReleaseOffer | null {
  if (!release) return null
  const chosen = release.offers.find((offer) => offer.tag === selectedReleaseTag)
    ?? release.offers[0]
    ?? null
  // Offers win over `tag`: a channel that failed its check leaves `tag` null
  // while the other channel still produced offers, and reading `tag` first
  // stranded those offers entirely.
  if (chosen) return chosen
  // No offers at all — an older main process, or a tag neither channel could
  // relate to the installed version. `action` is then the only description
  // there is, and it is what the mutation falls back to as well.
  if (!release.tag || release.action === 'none') return null
  return {
    channel: release.channel,
    relation: release.action === 'initial-install' ? 'initial-install' : 'update',
    tag: release.tag,
  }
}

/**
 * Whether Home may run `offer` against a Core that is currently up.
 *
 * All three conditions are required, and each one for its own reason:
 * an UPDATE (Home stops the Core, replaces the jar and starts it again,
 * restoring the previous install if that fails — an initial install has nothing
 * to restore, and a downgrade is never done in place); the runtime observed as
 * exactly 'running' ('unknown' means Home cannot see the Core at all, and
 * installing over one that is quietly still up corrupts it); and the capability
 * itself, which is what says Home started this Core and may stop it.
 */
export function canRunCoreOfferInPlace(
  offer: HomeV2CoreReleaseOffer | null,
  status: HomeV2CoreMaintenanceStatus | null | undefined,
): boolean {
  return offer?.relation === 'update' &&
    status?.core.runtime === 'running' &&
    status.capabilities.canUpdateRunningInPlace === true
}

export type HomeV2CoreReleaseGate = {
  /** The release an install button would install, or null when there is none. */
  readonly offer: HomeV2CoreReleaseOffer | null
  /** True when running the offer stops and restarts the Core itself. */
  readonly restartsCore: boolean
  /** True when there is an offer Home must not run in the Core's current state. */
  readonly blocked: boolean
  /**
   * Why it is blocked, so every surface prints the same reason.
   *
   * 'unknown' is NOT 'running': telling someone to stop a Core Home cannot see
   * is how they stop it again and are told the same thing.
   */
  readonly blockedReason: 'core-state-unknown' | 'stop-core-first' | null
}

/**
 * The one install gate. Settings, the dashboard tile and the toolbar node menu
 * all read this, so the button, its label and the notice underneath cannot
 * disagree again.
 */
export function coreReleaseGate(
  release: HomeV2CoreMaintenanceRelease | null | undefined,
  selectedReleaseTag: string | null | undefined,
  status: HomeV2CoreMaintenanceStatus | null | undefined,
): HomeV2CoreReleaseGate {
  const offer = effectiveCoreReleaseOffer(release, selectedReleaseTag)
  const restartsCore = canRunCoreOfferInPlace(offer, status)
  // A status Home has not read yet is treated as unknown rather than stopped:
  // the gate stays closed on the conservative side.
  const runtime = status?.core.runtime ?? 'unknown'
  const blocked = !!offer && runtime !== 'stopped' && !restartsCore
  return {
    blocked,
    blockedReason: !blocked
      ? null
      : runtime === 'unknown' ? 'core-state-unknown' : 'stop-core-first',
    offer,
    restartsCore,
  }
}
