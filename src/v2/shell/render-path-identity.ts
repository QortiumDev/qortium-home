// Fix A (finding 1), Android side: whether a rendered QDN URL's path still
// identifies the SAME app resource a tab was launched for. Mirrors the
// electron-side qdn-resource-identity module's identifier handling exactly
// (an explicit launch identifier must be preserved; a default/omitted one
// leaves the next path segment free for the app's own routing) — duplicated
// as a small, dependency-free module rather than imported, since the
// electron folder pulls in node/electron-only code the renderer cannot
// bundle (see the home-v2-foundation source-contract pin forbidding a
// relative import out to that folder from src/v2). Used by AppTabStage.tsx's
// AndroidAppStage to detect when the iframe's live location has drifted from
// its launch resource — see that file for the full residual/threat-model
// writeup.

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

// Whether `candidatePathname` still identifies the same APP resource
// `launch` was resolved for.
export function isSameRenderResourcePath(
  candidatePathname: string,
  launch: { readonly name: string; readonly identifier: string | null },
): boolean {
  const parsed = parseRenderPathIdentity(candidatePathname)
  if (!parsed || parsed.service !== 'APP' || parsed.name !== launch.name) return false
  return launch.identifier === null || parsed.nextSegment === launch.identifier
}
