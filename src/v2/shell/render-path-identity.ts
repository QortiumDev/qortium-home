// Fix A (finding 1), Android side: whether a rendered QDN URL's path still
// identifies the SAME app resource a tab was launched for. Mirrors the
// electron-side qdn-resource-identity module's identifier handling exactly
// (Core's RenderResource.getPathByName resolution: an explicit ?identifier=
// query wins when non-blank, else a non-"default" first path segment is a
// POSSIBLE identifier that must match the launch identifier, fail closed —
// this client cannot verify a segment is a REAL published identifier the way
// Core's isRealIdentifier does) — duplicated as a small, dependency-free
// module rather than imported, since the electron folder pulls in
// node/electron-only code the renderer cannot bundle (see the
// home-v2-foundation source-contract pin forbidding a relative import out to
// that folder from src/v2). Used by AppTabStage.tsx's AndroidAppStage to
// detect when the iframe's live location has drifted from its launch
// resource — see that file for the full residual/threat-model writeup.

export type QdnRenderPathIdentity = {
  readonly service: string
  readonly name: string
  // The raw path segment right after `name`. It MAY be an explicit resource
  // identifier, or it may just be the app's own first in-app route segment —
  // the render URL format is genuinely ambiguous between the two when the
  // launch identity's identifier is the default/omitted one, which is why
  // isSameRenderResourcePath only pins this against an *explicit* launch
  // identifier.
  readonly nextSegment: string | null
}

// Parses the `/render/<service>/<name>[/<segment>]` prefix of a rendered QDN
// URL's pathname (proxied or direct — both mirror the node's real render
// path).
export function parseRenderPathIdentity(pathname: string): QdnRenderPathIdentity | null {
  const segments = pathname.split('/')
  if (segments[1] !== 'render' || !segments[2] || !segments[3]) return null
  try {
    return {
      service: decodeURIComponent(segments[2]).toUpperCase(),
      name: decodeURIComponent(segments[3]),
      nextSegment: segments[4] ? decodeURIComponent(segments[4]) : null,
    }
  } catch {
    return null
  }
}

// Resolves the candidate identifier for a parsed render path exactly the way
// Core's RenderResource.getPathByName resolves it — see this module's header
// comment. Mirrors electron/qdn-resource-identity.ts's
// resolveCandidateIdentifier.
function resolveCandidateIdentifier(queryIdentifier: string | null, parsed: QdnRenderPathIdentity): string | null {
  if (queryIdentifier !== null && queryIdentifier.trim() !== '') return queryIdentifier
  if (parsed.nextSegment !== null && parsed.nextSegment.toLowerCase() !== 'default') return parsed.nextSegment
  return null
}

// Whether `candidateUrl` (a full render URL, so an `?identifier=` query can
// be inspected too — not just its pathname) still identifies the same APP
// resource `launch` was resolved for.
export function isSameRenderResourcePath(
  candidateUrl: string,
  launch: { readonly name: string; readonly identifier: string | null },
): boolean {
  let url: URL
  try {
    url = new URL(candidateUrl)
  } catch {
    return false
  }
  const parsed = parseRenderPathIdentity(url.pathname)
  if (!parsed || parsed.service !== 'APP' || parsed.name !== launch.name) return false
  const candidateIdentifier = resolveCandidateIdentifier(url.searchParams.get('identifier'), parsed)
  return launch.identifier === null
    ? candidateIdentifier === null
    : candidateIdentifier === launch.identifier
}

// Round 4, Defect B (Sol round-3 re-review): the app tab's TRUE launch
// identifier, resolved from the FULL first render request Home itself is
// about to issue for this tab — including any `?identifier=` query — not
// just the app-resource address's PATH-based identifier position.
//
// AppTabStage.tsx's resolveRender builds `resolved.url` from the tab's
// `resourceLocation` (a Home-owned `qdn://APP/name/identifier/route...`
// address, whose identifier POSITION is unambiguous — see
// resource-location.ts). But `parseAppResourceLocation` never inspects that
// address's `?identifier=` query for identity purposes, only its path — so
// an address like `qdn://APP/Chat/default?identifier=evil` is parsed as
// identity {name:'Chat', identifier:null} even though resolveRender's own
// URL-building carries the raw query (including `identifier=evil`) straight
// through into `resolved.url`. Core resolves an explicit `?identifier=`
// query as the identifier OUTRIGHT (it wins over any path position, no
// "is this a real identifier" check needed the way a bare path segment
// requires) — so the content Core actually serves for `resolved.url` IS the
// "evil" resource, while Home's own bookkeeping (the tab title, the native
// proxy's registered launch identity, permission-grant lookups) would keep
// calling it "Chat/default": a real resource ends up running with a
// different resource's declared identity.
//
// Folding the query in here — used at the Android proxy-authorization and
// live-resource-check call sites in AppTabStage.tsx — makes the declared
// launch identity match what will actually be loaded: opening
// `.../default?identifier=evil` is treated, consistently everywhere, as a
// launch of Chat/evil (a real, if attacker-chosen, resource) rather than a
// mislabeled Chat/default launch that quietly serves different content.
//
// This does not need to (and must not) touch `pathIdentifier` when NO query
// identifier is present: `pathIdentifier` already comes from Home's own
// unambiguous `qdn://` address parsing (parseAppResourceLocation), which is
// authoritative for the path case — unlike a raw `/render/...` path segment,
// there is no ambiguity to resolve there.
export function resolveLaunchIdentifier(pathIdentifier: string | null, renderUrl: string): string | null {
  let query: string | null = null
  try {
    query = new URL(renderUrl).searchParams.get('identifier')
  } catch {
    return pathIdentifier
  }
  return query !== null && query.trim() !== '' ? query : pathIdentifier
}
