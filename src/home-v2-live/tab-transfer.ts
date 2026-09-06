// Cross-window tab transfer, as pure data.
//
// A tab that moves to another window travels as a bounded JSON envelope of
// ADDRESSES plus one opaque account identifier. Nothing about the tab's
// internal shape crosses the main process: the receiving window rebuilds every
// destination from its address with the same parsers the address bar uses, and
// re-opens the tab through its ordinary open path, where account binding,
// catalogue validation and permissions are decided as they are for any other
// tab. No vault, grant, unlock, preview capability, viewer position, DOM or
// native-webview history session is representable here, by construction.
//
// Both halves live here, and pure, so the wire format has one definition and
// can be tested without a shell.
import { SAVED_GUEST_ACCOUNT_ID } from '../bookmarkManagerContract'
import { sanitizeHomeV2AppTitle } from '../v2/app-frame-messages'
import type { AppDescriptor, AppId, AppResourceLocation } from '../v2/contracts'
import {
  parseHomeV2CoreDocsAddress,
  parseHomeV2InternalAddress,
  parseHomeV2ReleaseNotesAddress,
  validateCustomNewTabAddress,
} from '../v2/new-tab-preference'
import { parseAppResourceLocation } from '../v2/resource-location'
import { isViewerAddress, parseViewerLocation } from '../v2/viewer-location'
import type { TabDestination, TabHistory } from './tab-navigation'

/** The envelope revision this build sends. Revision 1 was a bare address. */
export const HOME_V2_TAB_TRANSFER_REVISION = 2

/** Mirrors the main-process bound in electron/home-v2-window-startup.ts. */
export const HOME_V2_TAB_TRANSFER_MAX_HISTORY = 50

const HOME_V2_TAB_TRANSFER_ACCOUNT_ID_MAX_LENGTH = 400

export interface HomeV2TabTransferHistoryEntry {
  readonly address: string
  readonly title?: string
}

export interface HomeV2TabTransferHistory {
  readonly entries: readonly HomeV2TabTransferHistoryEntry[]
  readonly index: number
}

export interface HomeV2TabTransfer {
  readonly revision: typeof HOME_V2_TAB_TRANSFER_REVISION
  readonly address: string
  /** Always explicit: a Home account id, or the guest sentinel. Never absent. */
  readonly accountId: string
  readonly title?: string
  readonly history?: HomeV2TabTransferHistory
}

/** What the receiving window should do, once the payload has been believed. */
export interface HomeV2TabTransferPlan {
  readonly address: string
  /**
   * The account the tab was bound to, still in its saved form so the caller
   * decodes it with the existing `savedAccountBinding` precedent. `undefined`
   * ONLY for a revision-1 payload, which named no account and therefore keeps
   * the historical "open under this window's current account" behaviour.
   */
  readonly accountId: string | undefined
  readonly title: string | null
  readonly history: { readonly entries: readonly TabDestination[]; readonly index: number } | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The address form of a destination, or null when it has none.
 *
 * The result is put back through the address parsers, so a destination that
 * would not survive the round trip is dropped here rather than travelling as
 * something the receiver cannot open.
 */
export function homeV2TabTransferAddress(destination: TabDestination): string | null {
  const address =
    destination.kind === 'app' || destination.kind === 'viewer'
      ? destination.location
      : destination.kind === 'internal'
        ? `home://${destination.page}`
        : destination.kind === 'releases'
          ? `home://releases/${destination.target.product}/${encodeURIComponent(destination.target.tagName)}`
          : destination.network === 'qortal'
            ? 'qortal-core://'
            : 'core://'
  return typeof address === 'string' && transferableAddress(address) ? address : null
}

/** The parser chain the address bar uses, as a yes/no. */
function transferableAddress(value: string): string | null {
  try {
    return validateCustomNewTabAddress(value)
  } catch {
    return null
  }
}

/**
 * Rebuilds a destination from an address, or null when it is not one.
 *
 * The parse order is `validateCustomNewTabAddress`'s: internal page, release
 * notes, Core docs, public viewer, app. An app descriptor is rebuilt from the
 * location exactly as `openAddress` and `appDescriptorForOpenTab` do — the
 * descriptor is fully derivable from the address, so none of it has to travel.
 */
export function homeV2TabTransferDestination(
  address: string,
  title?: unknown,
): TabDestination | null {
  const value = typeof address === 'string' ? address.trim() : ''
  if (!value) return null

  const internal = parseHomeV2InternalAddress(value)
  if (internal) {
    // A transient page is never a TAB's own page; it only appears inside a
    // history, and it has its own address forms below.
    if (internal === 'core-docs' || internal === 'releases') return null
    // Settings sub-sections collapse to the page, matching destinationForEntry.
    return internal === 'settings'
      ? { kind: 'internal', page: 'settings', section: 'general' }
      : { kind: 'internal', page: internal }
  }
  const releaseNotes = parseHomeV2ReleaseNotesAddress(value)
  if (releaseNotes) return { kind: 'releases', target: releaseNotes }
  const coreDocs = parseHomeV2CoreDocsAddress(value)
  if (coreDocs) return { kind: 'core-docs', network: coreDocs }
  if (isViewerAddress(value)) {
    try {
      return { kind: 'viewer', location: parseViewerLocation(value).location }
    } catch {
      return null
    }
  }

  let parsed: ReturnType<typeof parseAppResourceLocation>
  try {
    parsed = parseAppResourceLocation(value)
  } catch {
    return null
  }
  // A bare app name can match more than one published resource, and resolving
  // that needs a node and a question for the user. History is replayed without
  // either, so an ambiguous entry is dropped rather than guessed at.
  if (!parsed.identifierWasExplicit) return null
  const identity = parsed.identity
  const appIdSuffix = identity.service === 'APP' ? '' : `:${identity.service}`
  const app: AppDescriptor = {
    id: `home-v2:app:${parsed.sourceNetwork}:${identity.name}:${identity.identifier ?? 'default'}${appIdSuffix}` as AppId,
    // Display only, and sanitised: it is a string another window supplied.
    title: sanitizeHomeV2AppTitle(title) ?? identity.name,
    description: `QDN app from ${parsed.sourceNetwork === 'qortal' ? 'Qortal' : 'Qortium'}.`,
    category: 'utility',
    sourceNetwork: parsed.sourceNetwork,
    resourceIdentity: identity,
    targetNetworks: [parsed.sourceNetwork],
    placement: 'recommended',
  }
  return { kind: 'app', app, location: parsed.location as AppResourceLocation }
}

function buildTransferHistory(
  address: string,
  history: TabHistory | undefined,
): HomeV2TabTransferHistory | undefined {
  if (!history || history.entries.length === 0) return undefined
  const entries: HomeV2TabTransferHistoryEntry[] = []
  let index = -1
  history.entries.forEach((destination, position) => {
    const entryAddress = homeV2TabTransferAddress(destination)
    if (!entryAddress) return
    if (position === history.index) index = entries.length
    const title = destination.kind === 'app' ? sanitizeHomeV2AppTitle(destination.app.title) : null
    entries.push(title ? { address: entryAddress, title } : { address: entryAddress })
  })
  // The current entry itself did not survive, so nothing left describes the
  // tab being opened.
  if (index < 0) return undefined

  // Bounded: keep a window around the current entry rather than the whole run.
  let start = 0
  if (entries.length > HOME_V2_TAB_TRANSFER_MAX_HISTORY) {
    const half = Math.floor(HOME_V2_TAB_TRANSFER_MAX_HISTORY / 2)
    start = Math.min(
      Math.max(0, index - half),
      entries.length - HOME_V2_TAB_TRANSFER_MAX_HISTORY,
    )
  }
  const windowed = entries.slice(start, start + HOME_V2_TAB_TRANSFER_MAX_HISTORY)
  const windowedIndex = index - start
  // One entry is what the receiver synthesizes for any new tab anyway.
  if (windowed.length < 2) return undefined
  // History that does not describe the address being opened would be ignored
  // by the receiver, so it is not worth sending.
  if (windowed[windowedIndex].address !== address) return undefined
  return { entries: windowed, index: windowedIndex }
}

/**
 * The envelope for a tab that is moving to another window.
 *
 * Pure, and non-mutating: the caller's entry, history and account id are only
 * read. `accountId: null` means the tab had NO account, and is sent as the
 * explicit guest sentinel so the receiving window cannot widen it to whatever
 * account happens to be selected there.
 */
export function buildHomeV2TabTransfer(input: {
  readonly address: string
  readonly title?: string
  readonly accountId: string | null
  readonly history?: TabHistory
}): HomeV2TabTransfer {
  const title = sanitizeHomeV2AppTitle(input.title)
  const history = buildTransferHistory(input.address, input.history)
  return {
    revision: HOME_V2_TAB_TRANSFER_REVISION,
    address: input.address,
    accountId: input.accountId ?? SAVED_GUEST_ACCOUNT_ID,
    ...(title ? { title } : {}),
    ...(history ? { history } : {}),
  }
}

function planTransferHistory(
  value: unknown,
): { readonly entries: readonly TabDestination[]; readonly index: number } | null {
  if (!isRecord(value) || !Array.isArray(value.entries)) return null
  const source = value.entries
  if (source.length === 0 || source.length > HOME_V2_TAB_TRANSFER_MAX_HISTORY) return null
  const sourceIndex = value.index
  if (
    typeof sourceIndex !== 'number' ||
    !Number.isInteger(sourceIndex) ||
    sourceIndex < 0 ||
    sourceIndex >= source.length
  ) {
    return null
  }
  const entries: TabDestination[] = []
  let index = -1
  source.forEach((raw, position) => {
    if (!isRecord(raw) || typeof raw.address !== 'string') return
    const destination = homeV2TabTransferDestination(raw.address, raw.title)
    if (!destination) return
    if (position === sourceIndex) index = entries.length
    entries.push(destination)
  })
  // Without the current entry there is nothing to check the opened tab against,
  // and a single entry is what the receiver would build for itself.
  if (index < 0 || entries.length < 2) return null
  return { entries, index }
}

/**
 * Decides what to do with a transfer payload that arrived over IPC.
 *
 * The main process has already sanitised it, and this validates it AGAIN
 * because it reaches the renderer as ordinary untrusted input. Returns null
 * when nothing usable can be made of it; a malformed history never fails the
 * open, it is simply not seeded.
 */
export function planHomeV2TabTransferOpen(value: unknown): HomeV2TabTransferPlan | null {
  const legacy = (address: string): HomeV2TabTransferPlan | null => {
    const validated = transferableAddress(address)
    // No account was named, so the historical current-account behaviour
    // stands: undefined, never a silent guest and never a claimed account.
    return validated ? { address: validated, accountId: undefined, title: null, history: null } : null
  }
  if (typeof value === 'string') return legacy(value)
  if (!isRecord(value)) return null
  if (typeof value.address !== 'string') return null
  if (value.revision === 1) return legacy(value.address)
  if (value.revision !== HOME_V2_TAB_TRANSFER_REVISION) return null

  const address = transferableAddress(value.address)
  if (!address) return null
  const accountId = typeof value.accountId === 'string' ? value.accountId.trim() : ''
  if (!accountId || accountId.length > HOME_V2_TAB_TRANSFER_ACCOUNT_ID_MAX_LENGTH) return null
  return {
    address,
    accountId,
    title: sanitizeHomeV2AppTitle(value.title),
    history: planTransferHistory(value.history),
  }
}
