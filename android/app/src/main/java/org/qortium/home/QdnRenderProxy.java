package org.qortium.home;

import android.net.Uri;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Serves QDN render content from an https origin inside the WebView.
 *
 * Android serves Home from https://localhost, so a QDN page loaded straight from
 * http://node:24891 is a mixed-content child: Chromium autoupgrades its images,
 * audio and video to https, the node has no TLS on its API port, and every one of
 * those requests is blocked. The page renders with no pictures and no sound.
 *
 * Serving the same content from an https origin removes that. The origin must NOT
 * be Home's own, or the QDN page would become same-origin with the app shell and
 * could reach its DOM and storage, so the proxy uses a separate host that only
 * this WebView resolves.
 *
 * The host label is derived from the node origin rather than from a per-view
 * token, for two reasons: Core injects a path-absolute {@code <base href>} into
 * every rendered page, so a path prefix would be discarded; and a per-view label
 * would give each view its own origin, silently wiping the local storage QDN apps
 * keep between visits.
 *
 * Only origins Home has authorized are served. Without that, a page could point
 * the proxy at any cleartext host the device can reach — the very capability the
 * mixed-content rule was denying it.
 */
final class QdnRenderProxy {

    /** Reserved for in-app content; it never resolves through DNS. */
    static final String PROXY_HOST_SUFFIX = ".qdn.androidplatform.net";
    static final String PROXY_MIME_QUERY_PARAM = "qdnHomeMime";

    private static final Map<String, AuthorizedOrigin> AUTHORIZED_ORIGINS = new ConcurrentHashMap<>();
    private static final String BASE58_SIGNATURE_PATTERN = "^[1-9A-HJ-NP-Za-km-z]{64,88}$";
    private static final Set<String> ALLOWED_RENDER_SERVICES = new HashSet<>(Arrays.asList(
        // Browser archives keep their existing isolated-host path.
        "APP",
        "WEBSITE",
        "GAME",
        "HASH",
        // Native <img>, <audio>, and <video> sources requested through
        // GET_QDN_RESOURCE_STREAM_URL. Generic file services are included
        // because publishers commonly place media under ATTACHMENT or FILE.
        "IMAGE",
        "THUMBNAIL",
        "QCHAT_IMAGE",
        "AUDIO",
        "VOICE",
        "PODCAST",
        "VIDEO",
        "DOCUMENT",
        "FILE",
        "FILES",
        "ATTACHMENT"
    ));

    private QdnRenderProxy() {}

    /**
     * @return the proxy origin for a node, or null when the node origin is unusable.
     */
    enum RouteKind {
        RENDER,
        PUBLIC_ARBITRARY,
        HOME_V2_BRIDGE_CLIENT,
        TRANSACTION_SIGNATURE,
        DENIED
    }

    /**
     * A Home v2 app tab's launch resource (Fix 2, Sol re-review #2): the
     * identity {@link #isSameActiveAppTabResource} requires an APP-service
     * RENDER request to resolve to, for the origin it is registered against.
     * {@code identifier} is {@code null} for a default/omitted identifier.
     *
     * <p>{@code initialPathname} is the exact path of this tab's OWN first
     * render request — computed by trusted React code
     * (AppTabStage.tsx resolveRender) from the tab's resourceLocation, not
     * from anything the app itself controls — and is always allowed
     * regardless of the identifier check below. This matters because a
     * legitimate OPEN_NEW_TAB deep link into a DEFAULT-identity app's
     * specific sub-page (e.g. a `qdn://APP/Trust/default/settings` address)
     * produces a first render request like {@code /render/APP/Trust/settings}
     * — a non-default first path segment that is otherwise indistinguishable
     * from the identifier-spoofing bypass this fix closes. Desktop has the
     * equivalent asymmetry: qdn-views.ts only runs the strict identity
     * predicate (isAllowedInViewNavigation) on IN-VIEW navigation, never on
     * the initial trusted qdn-views:show load. Re-registered on every
     * authorize() call, so it always reflects the CURRENT tab state, never a
     * stale exception an app could navigate back to later.
     */
    static final class AppIdentity {
        final String name;
        final String identifier;
        final String initialPathname;

        AppIdentity(String name, String identifier, String initialPathname) {
            this.name = name;
            this.identifier = identifier;
            this.initialPathname = initialPathname;
        }
    }

    private static final class AuthorizedOrigin {
        final String origin;
        final boolean homeV2;
        final AppIdentity activeAppIdentity;

        AuthorizedOrigin(String origin, boolean homeV2, AppIdentity activeAppIdentity) {
            this.origin = origin;
            this.homeV2 = homeV2;
            this.activeAppIdentity = activeAppIdentity;
        }
    }

    static String authorize(String origin) {
        return authorize(origin, false, null, null, null);
    }

    static String authorize(String origin, boolean homeV2) {
        return authorize(origin, homeV2, null, null, null);
    }

    /**
     * @param appName the launch resource's app name, or null/blank when this
     *     authorization carries no per-tab identity to enforce (v1's own
     *     non-Home-v2 QDN viewing, or a homeV2 origin authorized outside an
     *     app tab's launch — {@link #isSameActiveAppTabResource} then fails
     *     closed for APP-service RENDER routes on a homeV2 origin).
     * @param appIdentifier the launch resource's identifier, or null/blank
     *     for a default/omitted one.
     * @param initialPathname the exact path of this tab's own first render
     *     request (see {@link AppIdentity#initialPathname}), or null/blank
     *     to register no such exception.
     */
    static String authorize(
        String origin,
        boolean homeV2,
        String appName,
        String appIdentifier,
        String initialPathname
    ) {
        String normalizedOrigin = normalizeOrigin(origin);

        if (normalizedOrigin == null) {
            return null;
        }

        String label = getLabel(normalizedOrigin);
        AppIdentity activeAppIdentity = (appName == null || appName.isEmpty())
            ? null
            : new AppIdentity(
                appName,
                (appIdentifier == null || appIdentifier.isEmpty()) ? null : appIdentifier,
                (initialPathname == null || initialPathname.isEmpty()) ? null : initialPathname
            );

        AUTHORIZED_ORIGINS.put(label, new AuthorizedOrigin(normalizedOrigin, homeV2, activeAppIdentity));

        return "https://" + label + PROXY_HOST_SUFFIX;
    }

    static void release(String origin) {
        String normalizedOrigin = normalizeOrigin(origin);

        if (normalizedOrigin != null) {
            AUTHORIZED_ORIGINS.remove(getLabel(normalizedOrigin));
        }
    }

    static boolean isProxyUrl(Uri url) {
        if (url == null || !"https".equalsIgnoreCase(url.getScheme())) {
            return false;
        }

        String host = url.getHost();

        return host != null && host.toLowerCase(Locale.ROOT).endsWith(PROXY_HOST_SUFFIX);
    }

    /**
     * @return the upstream URL for a proxied request, or null when the host label is
     * not authorized or the path is not a QDN render path.
     */
    static String resolveUpstreamUrl(Uri url) {
        if (!isProxyUrl(url)) {
            return null;
        }

        String host = url.getHost().toLowerCase(Locale.ROOT);
        String label = host.substring(0, host.length() - PROXY_HOST_SUFFIX.length());
        AuthorizedOrigin authorization = AUTHORIZED_ORIGINS.get(label);

        if (authorization == null) {
            return null;
        }

        RouteKind route = classifyProxyRoute(url);

        if (route == RouteKind.DENIED || route == RouteKind.HOME_V2_BRIDGE_CLIENT) {
            return null;
        }

        StringBuilder upstream = new StringBuilder(authorization.origin);

        for (String segment : url.getPathSegments()) {
            upstream.append('/').append(Uri.encode(segment));
        }

        // A directory-style request must stay directory-style, or the page's own
        // relative asset paths resolve one segment too high.
        if (url.getPath() != null && url.getPath().endsWith("/")) {
            upstream.append('/');
        }

        String query = getUpstreamEncodedQuery(url.getEncodedQuery());

        if (query != null && !query.isEmpty()) {
            upstream.append('?').append(query);
        }

        return upstream.toString();
    }

    static RouteKind classifyProxyRoute(Uri url) {
        AuthorizedOrigin authorization = getAuthorization(url);

        if (authorization == null) {
            return RouteKind.DENIED;
        }

        RouteKind route = classifyProxyPath(url.getPathSegments(), url.getEncodedQuery(), authorization.homeV2);

        // Fix 2 (Sol re-review #2): a Home v2 app tab's launch identity, once
        // registered (see authorize() and AppTabStage.tsx), is the ONLY
        // resource this proxy will serve APP-service render content for on
        // this origin — see isSameActiveAppTabResource's doc comment for why
        // this is a real, trusted-layer fix and not the app-controlled
        // self-report backstop it supersedes.
        //
        // Round 4, Defect C (Sol round-3 re-review): PUBLIC_ARBITRARY is
        // checked here too, not just RENDER — /arbitrary/APP/<name>/... can
        // return a full HTML document exactly like /render/... can (see
        // QdnBridgeWebViewClient.fetchUpstream's HTML-content-type bridge
        // injection), so without this an authorized tab could load ANOTHER
        // app's resource through /arbitrary and have it treated as data,
        // even though isSameActiveAppTabResource's own segment indexing
        // (segments[1]=service, segments[2]=name, segments[3]=identifier) is
        // identical for both route prefixes. QdnBridgeWebViewClient
        // additionally never attaches the live bridge token to a
        // PUBLIC_ARBITRARY response at all (see its shouldCarryBridgeToken),
        // so this is defense in depth, not the only barrier.
        if (
            (route == RouteKind.RENDER || route == RouteKind.PUBLIC_ARBITRARY)
                && authorization.homeV2
                && !isSameActiveAppTabResource(
                    url.getPathSegments(),
                    url.getPath(),
                    url.getQueryParameter("identifier"),
                    authorization.activeAppIdentity
                )
        ) {
            return RouteKind.DENIED;
        }

        return route;
    }

    /**
     * Fix 2 (Sol re-review #2): whether an APP-service RENDER request
     * resolves to the SAME resource as the origin's registered active app
     * tab identity.
     *
     * <p>Android's Home v2 app tabs share one https proxy origin per node by
     * design (see this class's header comment), so origin alone cannot bound
     * a request to "this tab's app" the way a distinct origin would. The
     * previous defense (AppTabStage.tsx's AndroidAppStage tracking the
     * iframe's self-reported {@code qortium:qdn-navigation} location) is
     * app-controlled: a malicious app can simply not report an honest
     * location, or report a stale/forged one, and {@code
     * window.postMessage} is a native browser API available to ANY loaded
     * content regardless of whether Home's bridge script was injected into
     * it — so that check alone cannot be trusted to gate account-read/
     * signing requests.
     *
     * <p>This check instead sits where the render BYTES are actually served
     * (both {@code shouldInterceptRequest} for network requests — the source
     * of truth for what content can ever reach the WebView, including
     * navigations, XHR/fetch, and any other resource load — and {@code
     * shouldOverrideUrlLoading}, which cancels a doomed navigation before it
     * is even attempted). It works safely without per-frame/tab identity
     * (which the WebView APIs do not expose — see AppTabStage.tsx's
     * liveResourcePathRef comment) because Android renders at most ONE Home
     * v2 app tab's iframe at a time: switching tabs always destroys and
     * recreates the iframe (see AppTabStage.tsx), and {@code authorize()} is
     * always called with the newly active tab's identity BEFORE that new
     * iframe is created, so "the registered identity for this origin" is
     * always the currently displayed tab's — there is no window where two
     * live app tabs' identities could be confused.
     *
     * <p>{@code candidatePathname} is separately checked against {@link
     * AppIdentity#initialPathname} first — see that field's doc comment —
     * before falling through to the identifier check below. Round 4 (Sol
     * round-3 re-review, Defect B): that pathname exemption now applies ONLY
     * when the candidate carries no EXPLICIT {@code ?identifier=} query.
     * A path segment's identifier-vs-route meaning is genuinely ambiguous to
     * this proxy (see {@link #resolveCandidateIdentifier}'s doc comment),
     * which is what the exemption exists to paper over for the tab's own
     * trusted first request. An explicit query parameter has no such
     * ambiguity — Core (and this proxy) always treat it as the identifier —
     * so it must always be checked, even against the exempted pathname:
     * without this, a launch address that smuggles a different identifier
     * past its own declared path (e.g. a `.../default?identifier=evil`
     * OPEN_NEW_TAB address, whose render URL keeps that query — see
     * AppTabStage.tsx's resolveRender) would register {@code
     * initialPathname="/render/APP/Chat"} and then have its OWN first
     * request — carrying {@code ?identifier=evil} — wave itself through via
     * the pathname match, never reaching the identifier comparison at all.
     * (AppTabStage.tsx's authorize() call now also resolves the registered
     * {@code appIdentifier} itself from that same query, via
     * render-path-identity.ts's resolveLaunchIdentifier, so a correctly
     * wired caller registers "evil" as the launch identifier up front and
     * this check is consistent either way — but it must not rely on that
     * alone.)
     */
    static boolean isSameActiveAppTabResource(
        List<String> segments,
        String candidatePathname,
        String queryIdentifier,
        AppIdentity active
    ) {
        // segments = [render|arbitrary, service, name, identifierOrPathSegment, ...].
        // WEBSITE/GAME/HASH render paths carry no Home v2 account-read/
        // signing bridge (see AppTabStage.tsx resolveRender, which only ever
        // builds an APP-service render URL) and have no per-tab launch
        // identity registered against them — leave them exactly as
        // classifyProxyPath already scoped them.
        if (segments == null || segments.size() < 3 || !"APP".equalsIgnoreCase(segments.get(1))) {
            return true;
        }

        // Fail closed: a homeV2 origin serving APP render/arbitrary content
        // with no registered tab identity (authorize() was never called with
        // one, or the tab has not fully launched yet) has nothing to check
        // against.
        if (active == null) {
            return false;
        }

        boolean hasExplicitQueryIdentifier = queryIdentifier != null && !queryIdentifier.trim().isEmpty();

        // The tab's own trusted initial request is allowed even though its
        // first path segment may be indistinguishable from a spoofed
        // identifier — see AppIdentity#initialPathname's doc comment — but
        // ONLY for that ambiguous, no-query case. See this method's doc
        // comment for why an explicit query identifier is never covered by
        // this exemption.
        if (
            !hasExplicitQueryIdentifier
                && active.initialPathname != null
                && active.initialPathname.equals(candidatePathname)
        ) {
            return true;
        }

        if (!active.name.equals(segments.get(2))) {
            return false;
        }

        String candidateIdentifier = resolveCandidateIdentifier(segments, queryIdentifier);

        return active.identifier == null
            ? candidateIdentifier == null
            : active.identifier.equals(candidateIdentifier);
    }

    /**
     * Resolves the candidate identifier for a RENDER path's segments exactly
     * the way Core's RenderResource.getPathByName resolves it — mirrors
     * electron/qdn-resource-identity.ts's resolveCandidateIdentifier and
     * src/v2/shell/render-path-identity.ts's twin: an explicit {@code
     * identifier} query parameter wins when non-blank; otherwise a
     * non-"default" (case-insensitive) first path segment after the name is
     * a POSSIBLE identifier. This proxy cannot verify a segment is a REAL
     * published identifier the way Core's isRealIdentifier does, so it fails
     * closed and treats ANY non-default first segment as one.
     */
    static String resolveCandidateIdentifier(List<String> segments, String queryIdentifier) {
        if (queryIdentifier != null && !queryIdentifier.trim().isEmpty()) {
            return queryIdentifier;
        }

        if (segments != null && segments.size() >= 4) {
            String candidate = segments.get(3);

            if (!candidate.isEmpty() && !"default".equalsIgnoreCase(candidate)) {
                return candidate;
            }
        }

        return null;
    }

    static RouteKind classifyProxyPath(
        java.util.List<String> segments,
        String encodedQuery,
        boolean homeV2
    ) {

        if (segments == null || segments.size() < 2) {
            return RouteKind.DENIED;
        }

        for (String segment : segments) {
            if (".".equals(segment) || "..".equals(segment)) {
                return RouteKind.DENIED;
            }
        }

        if ("arbitrary".equals(segments.get(0))) {
            return RouteKind.PUBLIC_ARBITRARY;
        }

        if (
            segments.size() >= 3 &&
            "render".equals(segments.get(0)) &&
            ALLOWED_RENDER_SERVICES.contains(segments.get(1).toUpperCase(Locale.ROOT))
        ) {
            return RouteKind.RENDER;
        }

        if (
            homeV2 &&
            segments.size() == 2 &&
            "apps".equals(segments.get(0)) &&
            "q-apps.js".equals(segments.get(1))
        ) {
            return RouteKind.HOME_V2_BRIDGE_CLIENT;
        }

        if (
            homeV2 &&
            segments.size() == 3 &&
            "transactions".equals(segments.get(0)) &&
            "signature".equals(segments.get(1)) &&
            segments.get(2).matches(BASE58_SIGNATURE_PATTERN) &&
            (encodedQuery == null || encodedQuery.isEmpty())
        ) {
            return RouteKind.TRANSACTION_SIGNATURE;
        }

        return RouteKind.DENIED;
    }

    private static AuthorizedOrigin getAuthorization(Uri url) {
        if (!isProxyUrl(url)) {
            return null;
        }

        String host = url.getHost().toLowerCase(Locale.ROOT);
        String label = host.substring(0, host.length() - PROXY_HOST_SUFFIX.length());

        return AUTHORIZED_ORIGINS.get(label);
    }

    /**
     * Core can omit Content-Type for rendered binary resources. Home adds this
     * restricted hint when an app asks for a stream URL so WebView does not
     * default an audio or video response to HTML.
     */
    static String resolveResponseMimeType(Uri url) {
        if (!isProxyUrl(url)) {
            return null;
        }

        return sanitizeResponseMimeType(url.getQueryParameter(PROXY_MIME_QUERY_PARAM));
    }

    static String sanitizeResponseMimeType(String mimeType) {
        if (mimeType == null) {
            return null;
        }

        String normalized = mimeType.trim().toLowerCase(Locale.ROOT);

        if (normalized.matches("^(audio|video)/[a-z0-9][a-z0-9.+-]*$")) {
            return normalized;
        }

        if (
            "image/avif".equals(normalized) ||
            "image/bmp".equals(normalized) ||
            "image/gif".equals(normalized) ||
            "image/jpeg".equals(normalized) ||
            "image/png".equals(normalized) ||
            "image/webp".equals(normalized)
        ) {
            return normalized;
        }

        return null;
    }

    static String getUpstreamEncodedQuery(String encodedQuery) {
        if (encodedQuery == null || encodedQuery.isEmpty()) {
            return null;
        }

        String encodedProxyMimePrefix = PROXY_MIME_QUERY_PARAM + "=";
        StringBuilder upstreamQuery = new StringBuilder();

        for (String parameter : encodedQuery.split("&")) {
            if (
                parameter.equals(PROXY_MIME_QUERY_PARAM) ||
                parameter.startsWith(encodedProxyMimePrefix)
            ) {
                continue;
            }

            if (upstreamQuery.length() > 0) {
                upstreamQuery.append('&');
            }

            upstreamQuery.append(parameter);
        }

        return upstreamQuery.length() == 0 ? null : upstreamQuery.toString();
    }

    /** A stable, opaque host label: same node origin, same label, same storage. */
    private static String getLabel(String normalizedOrigin) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(normalizedOrigin.getBytes(StandardCharsets.UTF_8));
            StringBuilder label = new StringBuilder("n");

            for (int index = 0; index < 16; index += 1) {
                label.append(String.format(Locale.ROOT, "%02x", hash[index]));
            }

            return label.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is required to address the QDN render proxy.", error);
        }
    }

    private static String normalizeOrigin(String origin) {
        if (origin == null || origin.trim().isEmpty()) {
            return null;
        }

        Uri parsed = Uri.parse(origin.trim());
        String scheme = parsed.getScheme();
        String host = parsed.getHost();

        if (scheme == null || host == null) {
            return null;
        }

        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
            return null;
        }

        String normalized = scheme.toLowerCase(Locale.ROOT) + "://" + host.toLowerCase(Locale.ROOT);

        return parsed.getPort() == -1 ? normalized : normalized + ":" + parsed.getPort();
    }
}
