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
