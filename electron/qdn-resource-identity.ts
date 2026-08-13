// Fix A (finding 1): same-app-resource navigation binding.
//
// isAllowedRenderUrlForOrigin (electron/qdn-views.ts) only checks that a URL
// is *some* renderable QDN resource on the right node origin — it does not
// care WHICH app. That is deliberate for the very first load of a view, but
// once a view is showing an app, in-view navigation (will-navigate/
// will-frame-navigate/will-redirect, did-navigate/did-navigate-in-page,
// qdn-views:navigate history replay) must stay bound to that SAME app
// resource: otherwise App A's page can navigate itself to App B's render URL
// on the same node, and App B ends up running inside a view (and, on the
// permission side, a session grant) that still says "App A". Cross-app links
// already go through OPEN_NEW_TAB, which opens a fresh, independently-granted
// tab — so constraining in-view navigation like this removes no real
// capability.
//
// The identity used is (service, name, identifier): the QDN name is a
// registered, single-owner resource, so "different name" is the real
// cross-publisher/cross-app boundary; "different explicit identifier" under
// the same name is a distinct published resource and is blocked too.
//
// The identifier itself is resolved the way Core's RenderResource.
// getPathByName resolves it (qortium-core .../restricted/resource/
// RenderResource.java): an explicit `?identifier=` query wins outright when
// non-blank; otherwise a non-"default" first path segment after the name is
// a POSSIBLE identifier. Core additionally verifies that segment is a REAL
// published identifier (isRealIdentifier) before treating it as one and NOT
// part of the app's own path — this module cannot make that call from the
// client, so for this security predicate ANY non-default first segment is
// treated as an identifier and must match the launch identifier, fail
// closed. That can reject a legitimate deep link whose first segment merely
// looks like an identifier; that is the safe direction. Real apps launched
// at an explicit identifier keep that identifier in their base href (Core's
// HTMLParser only folds a non-default identifier into <base href>), so their
// own routing lives BELOW it — deeper path/query/hash segments there are
// never inspected and are always allowed as in-app routing. A default
// (omitted) launch identifier has no such prefix to route below, so it only
// tolerates query/hash-based in-app routing here, not a further path
// segment. Hash-addressed resources (/render/hash/<hash>/...) have no
// identifier concept at all (Core's getPathByHash never parses one), so any
// further path segment there is always in-app routing.
//
// This module is deliberately free of node/electron-only imports (managed-
// archive `file://` identity needs Electron's `app.getPath`, so that piece is
// injected via `QdnArchiveIdentityResolver` rather than imported directly) —
// that keeps it plain-Node testable and importable from qdn-views.test.ts
// without booting Electron.

export type QdnResourceLaunchRef = {
  readonly nodeOrigin: string;
  // A render URL this view has actually loaded, used as a fallback identity
  // reference only when `resourceUrl` below is absent (e.g. a direct
  // resource viewer that never carried an app identity to begin with).
  readonly requestedUrl: string | null;
  // The stable `qdn://SERVICE/name[/identifier]` (or `qortal://...`) app
  // identity Home's trusted top-level UI attached when it asked this view to
  // load — see src/v2/resource-location.ts buildAppResourceLocation and
  // src/qdn.ts buildQdnDisplayUrl/parseQdnUrl, which both encode a literal
  // "default" identifier segment as the sentinel for "none".
  readonly resourceUrl: string | null;
};

// The managed-archive side of identity resolution needs Electron's
// `app.getPath` (via qdn-archive-render.ts), so it is supplied by the caller
// (electron/qdn-views.ts in production; a stub in tests) instead of imported.
export type QdnArchiveIdentityResolver = {
  isArchiveUrl(url: string): boolean;
  // Returns a stable identity string for a managed-archive render URL
  // (unique per published resource *and* content version), or null when the
  // URL cannot be resolved to one.
  getArchiveIdentity(url: string): string | null;
};

export type QdnResourcePathIdentity = {
  readonly service: string;
  readonly name: string;
  // The raw path segment right after `name`. It MAY be an explicit resource
  // identifier, or it may just be the app's own first in-app route segment —
  // the render URL format is genuinely ambiguous between the two, which Core
  // resolves with a real-identifier lookup this client cannot replicate. See
  // resolveCandidateIdentifier and this module's header comment for how
  // isQdnRenderUrlSameAppResource resolves that ambiguity (fail closed).
  readonly nextSegment: string | null;
};

// Parses the `/render/<service>/<name>/<...>` (or `/render/hash/<hash>/<...>`)
// path of a rendered QDN URL.
export function parseRenderPathIdentity(pathname: string): QdnResourcePathIdentity | null {
  const segments = pathname.split('/');

  if (segments[1] !== 'render') {
    return null;
  }

  if (segments[2] === 'hash') {
    return typeof segments[3] === 'string' && segments[3]
      ? { service: 'HASH', name: segments[3], nextSegment: segments[4] || null }
      : null;
  }

  if (typeof segments[2] !== 'string' || !segments[2] || typeof segments[3] !== 'string' || !segments[3]) {
    return null;
  }

  let service: string;
  let name: string;

  try {
    service = decodeURIComponent(segments[2]).toUpperCase();
    name = decodeURIComponent(segments[3]);
  } catch {
    return null;
  }

  let nextSegment: string | null = null;

  if (typeof segments[4] === 'string' && segments[4]) {
    try {
      nextSegment = decodeURIComponent(segments[4]);
    } catch {
      // Fail closed: a segment that cannot even be decoded must not be
      // silently treated as "no identifier" (null), which would wrongly
      // ALLOW a default-launch candidate through. Invalidate the whole parse
      // instead, matching src/v2/shell/render-path-identity.ts.
      return null;
    }
  }

  return { service, name, nextSegment };
}

// Parses a Home-internal app identity URL (`qdn://SERVICE/name[/identifier]`
// or `qortal://SERVICE/name[/identifier]`). Mirrors
// src/v2/resource-location.ts parseAppResourceLocation and src/qdn.ts
// parseQdnUrl's identifier handling: a literal (case-insensitive) "default"
// identifier segment means "no identifier", matching how both builders
// encode "none".
export function parseQdnResourceUrlIdentity(
  rawResourceUrl: string,
): { service: string; name: string; identifier: string | null } | null {
  let url: URL;

  try {
    url = new URL(rawResourceUrl);
  } catch {
    return null;
  }

  const scheme = url.protocol.slice(0, -1).toLowerCase();

  if ((scheme !== 'qdn' && scheme !== 'qortal') || !url.hostname) {
    return null;
  }

  let service: string;

  try {
    service = decodeURIComponent(url.hostname).toUpperCase();
  } catch {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const rawName = segments[0];

  if (!rawName) {
    return null;
  }

  let name: string;

  try {
    name = decodeURIComponent(rawName);
  } catch {
    return null;
  }

  let identifier: string | null = null;

  if (segments.length > 1) {
    try {
      const decoded = decodeURIComponent(segments[1]);
      identifier = decoded.toLowerCase() === 'default' ? null : decoded;
    } catch {
      return null;
    }
  }

  return { service, name, identifier };
}

type QdnLaunchIdentity =
  | { readonly kind: 'archive'; readonly cacheDir: string }
  | { readonly kind: 'render'; readonly service: string; readonly name: string; readonly identifier: string | null };

function getLaunchIdentity(ref: QdnResourceLaunchRef, archive: QdnArchiveIdentityResolver): QdnLaunchIdentity | null {
  if (ref.resourceUrl) {
    const declared = parseQdnResourceUrlIdentity(ref.resourceUrl);

    if (declared) {
      return { kind: 'render', service: declared.service, name: declared.name, identifier: declared.identifier };
    }
  }

  if (!ref.requestedUrl) {
    return null;
  }

  if (archive.isArchiveUrl(ref.requestedUrl)) {
    const cacheDir = archive.getArchiveIdentity(ref.requestedUrl);
    return cacheDir ? { kind: 'archive', cacheDir } : null;
  }

  try {
    const parsedPath = parseRenderPathIdentity(new URL(ref.requestedUrl).pathname);
    // No declared resourceUrl to pin an identifier against: treat this view
    // as launched with a default (null) identifier. Per the header comment,
    // a null launch identifier only tolerates a candidate that ALSO resolves
    // to null/default — this is the fail-closed direction, not a "next
    // segment is always in-app routing" exemption.
    return parsedPath ? { kind: 'render', service: parsedPath.service, name: parsedPath.name, identifier: null } : null;
  } catch {
    return null;
  }
}

// Resolves the candidate identifier for a parsed render URL exactly the way
// Core's RenderResource.getPathByName resolves it: an explicit `?identifier=`
// query wins outright when non-blank; otherwise a non-"default" (case-
// insensitive) first path segment after the name is treated as the
// identifier. See this module's header comment for why the client treats
// ANY such segment as a possible identifier rather than trying to guess
// whether it is a real one.
function resolveCandidateIdentifier(url: URL, parsedPath: QdnResourcePathIdentity): string | null {
  const queryIdentifier = url.searchParams.get('identifier');

  if (queryIdentifier !== null && queryIdentifier.trim() !== '') {
    return queryIdentifier;
  }

  if (parsedPath.nextSegment !== null && parsedPath.nextSegment.toLowerCase() !== 'default') {
    return parsedPath.nextSegment;
  }

  return null;
}

// Whether `candidateUrl` still points at the SAME app resource `ref` was
// launched for.
export function isQdnRenderUrlSameAppResource(
  candidateUrl: string,
  ref: QdnResourceLaunchRef,
  archive: QdnArchiveIdentityResolver,
): boolean {
  const launch = getLaunchIdentity(ref, archive);

  // Nothing to compare against yet (e.g. this view has never loaded
  // anything) — let the caller's own origin/service allowlist decide.
  if (!launch) {
    return true;
  }

  if (launch.kind === 'archive') {
    if (!archive.isArchiveUrl(candidateUrl)) {
      return false;
    }

    const cacheDir = archive.getArchiveIdentity(candidateUrl);
    return !!cacheDir && cacheDir === launch.cacheDir;
  }

  if (archive.isArchiveUrl(candidateUrl)) {
    return false;
  }

  let url: URL;

  try {
    url = new URL(candidateUrl);
  } catch {
    return false;
  }

  if (url.origin !== ref.nodeOrigin) {
    return false;
  }

  const parsedPath = parseRenderPathIdentity(url.pathname);

  if (!parsedPath || parsedPath.service !== launch.service || parsedPath.name !== launch.name) {
    return false;
  }

  // Hash-addressed resources have no identifier concept — see this module's
  // header comment — so once service+name (the hash) match, any further path
  // segment is always in-app routing.
  if (parsedPath.service === 'HASH') {
    return true;
  }

  const candidateIdentifier = resolveCandidateIdentifier(url, parsedPath);

  // Mirrors Core's identifier resolution exactly: an explicit launch
  // identifier must equal the candidate's resolved identifier exactly; a
  // null (default/omitted) launch identifier requires the candidate to ALSO
  // resolve to null/default — a non-default first segment or an explicit
  // `?identifier=` reaches a genuinely different resource under Core's real
  // resolution and must be blocked, fail closed (see header comment).
  return launch.identifier === null
    ? candidateIdentifier === null
    : candidateIdentifier === launch.identifier;
}
