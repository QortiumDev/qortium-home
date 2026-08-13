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
// the same name is a distinct published resource and is blocked too. Deeper
// path/query/hash segments (SPA routes, sub-pages) are never inspected, so
// legitimate in-app navigation is always allowed.
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
  // the render URL format is genuinely ambiguous between the two when the
  // launch identity's identifier is the default/omitted one, which is why
  // isQdnRenderUrlSameAppResource only pins this against an *explicit*
  // launch identifier.
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
      nextSegment = null;
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
    // No declared resourceUrl to pin an identifier against: treat any next
    // segment as in-app routing rather than a different resource.
    return parsedPath ? { kind: 'render', service: parsedPath.service, name: parsedPath.name, identifier: null } : null;
  } catch {
    return null;
  }
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

  // An explicit launch identifier must be preserved exactly; a default
  // (omitted) launch identifier leaves the next segment free for the app's
  // own routing (see the ambiguity note on QdnResourcePathIdentity).
  return launch.identifier === null || parsedPath.nextSegment === launch.identifier;
}
