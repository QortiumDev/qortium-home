// OPEN_EXTERNAL_LINK — the one way a QDN app can send the user to an http(s)
// page, and it goes through the user, never around them.
//
// Home 2 apps cannot navigate themselves to the open web: an app tab only ever
// renders QDN, and the shell refuses http(s) in the address bar. That keeps a
// published app from being a phishing or tracking surface — but it also meant
// every web link in a chat message was copy-only. This action gives an app a
// host-mediated open: Home validates the URL, shows the user exactly which
// site and which link (a single-request prompt, never a durable grant — an
// app that could open the browser at will is an app that can nag and can
// track), and only on approval hands the URL to the operating system's
// default browser. Nothing is fetched by Home, nothing is rendered in a Home
// tab, and the app learns only whether the user approved.
//
// Pure contract module shared by the desktop bridge and the Android shell:
// the same validation, the same rows, the same pending-prompt discipline.

export const HOME_V2_EXTERNAL_LINK_ACTION = 'OPEN_EXTERNAL_LINK' as const

// Long enough for any real link (signed CDN URLs run to ~1,000 chars), short
// enough that a prompt can show the whole thing in a scrolling row.
export const HOME_V2_EXTERNAL_LINK_MAX_LENGTH = 2_048

export type HomeV2ExternalLinkRequest = {
  /** The normalized absolute URL the browser will receive. */
  readonly url: string
  /** The host shown to the user, lower-cased, IDN kept as the browser shows it. */
  readonly host: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Validates an app's OPEN_EXTERNAL_LINK request. Only absolute http(s) URLs
 * with a host and no embedded credentials are accepted; everything else fails
 * BEFORE any prompt, so a malformed request can never raise a question the
 * user cannot answer correctly.
 */
export function normalizeHomeV2ExternalLinkRequest(request: unknown): HomeV2ExternalLinkRequest {
  const raw = isRecord(request) ? request.url : undefined
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('OPEN_EXTERNAL_LINK requires a url.')
  }
  const trimmed = raw.trim()
  if (trimmed.length > HOME_V2_EXTERNAL_LINK_MAX_LENGTH) {
    throw new Error(`OPEN_EXTERNAL_LINK url must be at most ${HOME_V2_EXTERNAL_LINK_MAX_LENGTH} characters.`)
  }
  // Control characters and whitespace inside the URL are how a link is made to
  // read as one thing and resolve as another; the URL parser would strip some
  // and percent-encode others, so refuse them outright.
  if (/[\u0000-\u0020\u007f]/.test(trimmed)) {
    throw new Error('OPEN_EXTERNAL_LINK url contains control characters or whitespace.')
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('OPEN_EXTERNAL_LINK url must be an absolute http or https URL.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('OPEN_EXTERNAL_LINK only opens http and https links.')
  }
  if (!url.hostname) {
    throw new Error('OPEN_EXTERNAL_LINK url must name a host.')
  }
  if (url.username || url.password) {
    throw new Error('OPEN_EXTERNAL_LINK url must not carry credentials.')
  }
  // Home's own surfaces live on loopback (the Core's /render on 127.0.0.1,
  // the Android render proxy on localhost). A link there is not "the open
  // web" the prompt promises, and on Android a same-origin open could land
  // in the shell WebView rather than a browser — refuse it outright.
  if (isLoopbackHostname(url.hostname)) {
    throw new Error('OPEN_EXTERNAL_LINK cannot open links to this device.')
  }
  return Object.freeze({ host: url.host.toLowerCase(), url: url.toString() })
}

export function isLoopbackHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host === '10.0.2.2' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^0(\.0){0,3}$/.test(host) ||
    /^::ffff:127\./.test(host)
  )
}

/**
 * The rows the approval prompt shows. The link is the substance of the prompt
 * — the user is answering "open THIS page in my browser?", not "let this app
 * open pages" — so it is shown in full, and the host is repeated on its own
 * row because a long path can push the part that matters out of view.
 */
export function getHomeV2ExternalLinkApprovalDetails(request: HomeV2ExternalLinkRequest) {
  return Object.freeze([
    Object.freeze({ label: 'Site', value: request.host }),
    Object.freeze({ label: 'Link', value: request.url }),
  ])
}

export const HOME_V2_EXTERNAL_LINK_PROMPT_LIMITS = Object.freeze({
  // One open at a time per app: an app that wants to open five pages asks
  // five times, in order, and cannot stack five modals in Home chrome.
  perApp: 1,
  global: 10,
})

const HOME_V2_EXTERNAL_LINK_GRANT_KEY_PREFIX = 'home-v2:external-link:'

export function buildHomeV2ExternalLinkGrantKey(input: {
  readonly appIdentityKey: string
  readonly protocol: string
  readonly tabId: string
  readonly url: string
  readonly windowId: number | string
}): string {
  return [
    `${HOME_V2_EXTERNAL_LINK_GRANT_KEY_PREFIX}${input.windowId}`,
    input.tabId,
    input.appIdentityKey,
    input.protocol,
    input.url,
  ].join('|')
}

export type HomeV2ExternalLinkPendingPrompt = {
  readonly appIdentityKey?: string
  readonly grantKey?: string
}

/**
 * Decides whether one more link prompt may be queued. `pending` is EVERY
 * outstanding prompt across every window (see the Home-settings contract for
 * why filtering by window silently makes the limits per-window).
 */
export function assertHomeV2ExternalLinkPromptAdmissible(
  pending: readonly HomeV2ExternalLinkPendingPrompt[],
  candidate: { readonly appIdentityKey: string; readonly grantKey: string },
): void {
  const linkPrompts = pending.filter((entry) => entry.grantKey?.startsWith(HOME_V2_EXTERNAL_LINK_GRANT_KEY_PREFIX))
  if (linkPrompts.some((entry) => entry.grantKey === candidate.grantKey)) {
    throw new Error('This link is already waiting for your answer.')
  }
  if (linkPrompts.filter((entry) => entry.appIdentityKey === candidate.appIdentityKey).length >= HOME_V2_EXTERNAL_LINK_PROMPT_LIMITS.perApp) {
    throw new Error('This app already has a link waiting for your answer.')
  }
  if (linkPrompts.length >= HOME_V2_EXTERNAL_LINK_PROMPT_LIMITS.global) {
    throw new Error('Too many links are waiting for your answer. Answer the existing prompts first.')
  }
}
