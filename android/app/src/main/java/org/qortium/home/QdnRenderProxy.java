package org.qortium.home;

import android.net.Uri;
import android.util.Base64;
import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
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
    static final String STREAM_CAPABILITY_QUERY_PARAM = "qdnHomeStream";
    /** The shell-origin stream route: the Capacitor shell document's own
     * origin, served by the SAME WebView interceptor as the app proxy. */
    static final String SHELL_STREAM_HOST = "localhost";
    static final String SHELL_STREAM_PATH = "/qdn-home-stream";
    static final long STREAM_CAPABILITY_TTL_MS = 10L * 60L * 1000L;
    static final int PRIVATE_STREAM_CAPABILITY_MAX_ENTRIES = 64;
    static final int UPSTREAM_STREAM_CAPABILITY_MAX_ENTRIES = 256;

    /**
     * Round 6: shared with {@link QdnBridgeWebViewClient}, which reads the live
     * signing/account-read bridge token off this query param on every proxied
     * request. Defined here (not duplicated) because it is now also one of the
     * two query params {@link #normalizeQuery} ignores when comparing a
     * candidate request's document identity against the registered {@link
     * AuthorizedDocument} — a single source of truth removes any chance of the
     * ignore-list and the actual token param name drifting apart.
     */
    static final String QDN_BRIDGE_TOKEN_QUERY_PARAM = "qdnHomeBridge";

    /**
     * Round 6: the ONLY query params the exact-URL document identity check
     * (see {@link #normalizeQuery}, {@link #isExactAuthorizedRenderDocument})
     * ignores — everything else participates in the comparison and, if
     * different from what was registered, causes a mismatch (fail closed; see
     * that method's doc comment). These are display-only params AppTabStage.tsx's
     * resolveRender always sets on every request regardless of which app is
     * open (see that function), so they can never distinguish one app resource
     * from another, plus the live bridge token itself (random per tab, and
     * explicitly excluded from the identity comparison by design — see the
     * round-6 spec's normalization rule). {@code homeV2Bridge} — the OTHER
     * marker AndroidAppStage.tsx adds — is deliberately NOT in this list: it is
     * a constant ("1") added identically to both the registered authorized URL
     * and every actual request for a homeV2 app tab (see AppTabStage.tsx), so
     * it already compares equal without needing a special case, and leaving it
     * as an ordinary compared param avoids growing this ignore-list beyond
     * what the spec explicitly calls for.
     */
    private static final Set<String> IGNORED_DOCUMENT_QUERY_PARAMS = new HashSet<>(Arrays.asList(
        "theme",
        "lang",
        "textSize",
        "accent",
        "uiStyle",
        QDN_BRIDGE_TOKEN_QUERY_PARAM
    ));

    private static final Map<String, AuthorizedOrigin> AUTHORIZED_ORIGINS = new ConcurrentHashMap<>();
    private static final Map<String, AuthorizedStream> AUTHORIZED_STREAMS = new ConcurrentHashMap<>();
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
     * Round 6 (owner-directed redesign, ending the round-2/4/5 "identifier
     * confusion" bug class): the identity resolved from a Home v2 app tab's
     * registered launch resource — the SHELL-computed, trusted render document
     * URL (AppTabStage.tsx's {@code resolved.url}, before the per-tab bridge
     * token is appended) passed into {@link #authorize(String, boolean,
     * String)} — never anything the app itself reports.
     *
     * <p>Two independent things are derived from that ONE registered URL, by
     * ONE parser ({@link #buildAuthorizedDocument}), instead of the caller
     * separately computing and passing each one (round 4's Defect B was
     * exactly this kind of drift: a caller-computed identifier disagreeing
     * with what the URL itself would resolve to):
     *
     * <ul>
     *   <li>{@code pathname}/{@code query} — the normalized (see {@link
     *       #normalizePathnameFromSegments}, {@link #normalizeQuery}) exact
     *       document identity {@link #isExactAuthorizedRenderDocument} checks
     *       a RENDER document request against. This is the round-6 security
     *       gate: the live signing/account-read bridge token is carried and
     *       the response is injected ONLY for a request whose normalized URL
     *       equals this exactly. CSP remains enforced for every document.</li>
     *   <li>{@code name}/{@code identifier} — the coarser app-resource
     *       identity {@link #isAuthorizedAppResource} still checks for
     *       PUBLIC_ARBITRARY (data) reads, preserving round 4's containment
     *       (an authorized tab cannot enumerate another app's, or another
     *       identifier's, files via {@code /arbitrary}) — unaffected by round
     *       6, since /arbitrary requests have a different query shape
     *       ({@code filepath=...}, not this proxy's reserved display params)
     *       that exact-URL equality was never meant to apply to.</li>
     * </ul>
     *
     * <p>{@code name}/{@code identifier} are {@code null} when the registered
     * URL is not a {@code /render/APP/<name>...} path at all (authorize() was
     * called with no per-tab document, e.g. v1's own non-Home-v2 QDN viewing)
     * — both checks above fail closed in that case.
     */
    static final class AuthorizedDocument {
        final String pathname;
        final String query;
        final String name;
        final String identifier;

        AuthorizedDocument(String pathname, String query, String name, String identifier) {
            this.pathname = pathname;
            this.query = query;
            this.name = name;
            this.identifier = identifier;
        }
    }

    private static final class AuthorizedOrigin {
        final String origin;
        final boolean homeV2;
        final String hostingNetwork;
        final AuthorizedDocument authorizedDocument;

        AuthorizedOrigin(
            String origin,
            boolean homeV2,
            String hostingNetwork,
            AuthorizedDocument authorizedDocument
        ) {
            this.origin = origin;
            this.homeV2 = homeV2;
            this.hostingNetwork = hostingNetwork;
            this.authorizedDocument = authorizedDocument;
        }
    }

    // Which serving route a capability token may be redeemed on. A token minted
    // for an app (APP_PROXY / PRIVATE_BYTES) must NOT be redeemable on the shell
    // origin, or an app could take its own GET_QDN_RESOURCE_STREAM_URL token,
    // point it at attacker-controlled HTML, and top-navigate the shell origin
    // to it — running scripts as https://localhost. Only the viewer's own
    // SHELL_STREAM tokens serve on the shell route.
    enum StreamAudience { APP_PROXY, PRIVATE_BYTES, SHELL_STREAM }

    static final class AuthorizedStream {
        final String binding;
        final long expiresAt;
        final String proxyHost;
        final String proxyPath;
        final String upstreamQuery;
        final String upstreamUrl;
        final byte[] privateBytes;
        final String privateMimeType;
        final StreamAudience audience;

        AuthorizedStream(
            String binding,
            long expiresAt,
            String proxyHost,
            String proxyPath,
            String upstreamQuery,
            String upstreamUrl,
            byte[] privateBytes,
            String privateMimeType,
            StreamAudience audience
        ) {
            this.binding = binding;
            this.expiresAt = expiresAt;
            this.proxyHost = proxyHost;
            this.proxyPath = proxyPath;
            this.upstreamQuery = upstreamQuery;
            this.upstreamUrl = upstreamUrl;
            this.privateBytes = privateBytes;
            this.privateMimeType = privateMimeType;
            this.audience = audience;
        }
    }

    static String authorize(String origin) {
        return authorize(origin, false, null);
    }

    static String authorize(String origin, boolean homeV2) {
        return authorize(origin, homeV2, null);
    }

    /**
     * @param authorizedDocumentUrl the tab's SHELL-computed, trusted render
     *     document URL (AppTabStage.tsx's {@code resolved.url}) — the sole
     *     document this origin will ever carry the live bridge token and
     *     inject (see {@link AuthorizedDocument}) — or null/blank
     *     when this authorization carries no per-tab document to enforce (v1's
     *     own non-Home-v2 QDN viewing, or a homeV2 origin authorized outside an
     *     app tab's launch — every check below then fails closed).
     */
    static String authorize(String origin, boolean homeV2, String authorizedDocumentUrl) {
        return authorize(origin, homeV2, authorizedDocumentUrl, "qortium");
    }

    /**
     * Registers the node origin and the shell-selected hosting network for a
     * Home v2 app tab. The network is supplied by the trusted shell route,
     * alongside the exact document URL; it is never inferred from app content
     * or from a request's path/query. Qortal and Qortium Core use different
     * render identifier layouts, so this context is required for containment.
     */
    static String authorize(
        String origin,
        boolean homeV2,
        String authorizedDocumentUrl,
        String hostingNetwork
    ) {
        String normalizedOrigin = normalizeOrigin(origin);

        if (normalizedOrigin == null) {
            return null;
        }

        String normalizedNetwork = normalizeHostingNetwork(hostingNetwork);

        // Legacy non-Home-v2 callers do not carry a hosting-network field and
        // retain the historical Qortium behavior. Home v2 must provide the
        // shell-selected network explicitly so Qortal cannot be misclassified.
        if (normalizedNetwork == null && !homeV2) {
            normalizedNetwork = "qortium";
        }

        if (normalizedNetwork == null) {
            return null;
        }

        String label = getLabel(normalizedOrigin);
        AuthorizedDocument authorizedDocument = parseAuthorizedDocument(
            normalizedOrigin,
            authorizedDocumentUrl,
            normalizedNetwork
        );

        AUTHORIZED_ORIGINS.put(
            label,
            new AuthorizedOrigin(normalizedOrigin, homeV2, normalizedNetwork, authorizedDocument)
        );

        return "https://" + label + PROXY_HOST_SUFFIX;
    }

    static void release(String origin) {
        String normalizedOrigin = normalizeOrigin(origin);

        if (normalizedOrigin != null) {
            AUTHORIZED_ORIGINS.remove(getLabel(normalizedOrigin));
        }
    }

    static String authorizeStream(String origin, String resourceUrl, String mimeType, String binding) {
        return authorizeStream(origin, resourceUrl, mimeType, binding, false);
    }

    /**
     * With {@code shellStream} the capability URL is minted on the SHELL's own
     * origin ({@code https://localhost/qdn-home-stream?…}) instead of the app
     * proxy origin. The shell document's resource viewer needs a same-origin
     * media URL: its CSP is same-origin-only, and WebView refuses cross-origin
     * media loads against interceptor-only virtual origins outright
     * (2026-08-26 phone-pass finding H-P2). The unguessable, expiring token
     * remains the sole authority either way — the shell form grants nothing
     * the proxy form does not, it only changes which origin may embed it.
     */
    static String authorizeStream(String origin, String resourceUrl, String mimeType, String binding, boolean shellStream) {
        return authorizeStream(origin, resourceUrl, mimeType, binding, shellStream, null);
    }

    /**
     * Authorizes a stream for a Home v2 app proxy origin while retaining the
     * node origin as the fixed upstream. The app origin is supplied by Home's
     * trusted shell context, never by QDN app input; legacy callers omit it and
     * retain the node-derived proxy origin.
     */
    static String authorizeStream(
        String origin,
        String resourceUrl,
        String mimeType,
        String binding,
        boolean shellStream,
        String appOrigin
    ) {
        String normalizedOrigin = normalizeOrigin(origin);
        if (normalizedOrigin == null || resourceUrl == null || binding == null || binding.trim().isEmpty()) {
            return null;
        }
        Uri resource = Uri.parse(resourceUrl);
        String resourceOrigin = canonicalizeOrigin(resource.getScheme(), resource.getHost(), resource.getPort());
        RouteKind resourceRoute = classifyProxyPath(resource.getPathSegments(), resource.getEncodedQuery(), false);
        boolean allowedRawByteResource = isAllowedRawByteResourcePath(
            resource.getPathSegments(),
            resource.getEncodedQuery()
        );
        boolean safeFilepathQuery = hasSafeFilepathQuery(resource.getEncodedQuery());
        if (
            !normalizedOrigin.equals(resourceOrigin) ||
            resource.getUserInfo() != null ||
            resource.getFragment() != null ||
            !safeFilepathQuery ||
            // RENDER covers the existing rendered/streamable resources. Raw
            // bytes are a deliberately narrower capability: only the exact
            // /arbitrary/FILE|FILES/<name>[/<identifier>] coordinate shape
            // produced by Home is eligible. classifyProxyPath remains broad
            // for ordinary public reads, but must not widen this minting API.
            (resourceRoute != RouteKind.RENDER && !allowedRawByteResource)
        ) {
            return null;
        }

        // Validate the optional audience before sweeping or evicting existing
        // capabilities. An invalid caller must not consume capability-table
        // maintenance work or alter another stream's lifetime.
        String defaultProxyHost = getLabel(normalizedOrigin) + PROXY_HOST_SUFFIX;
        String registeredAppProxyHost = getAppProxyHost(appOrigin);
        String proxyHost = selectStreamCapabilityHost(
            defaultProxyHost,
            appOrigin,
            registeredAppProxyHost,
            isAuthorizedHomeV2ProxyHost(registeredAppProxyHost),
            shellStream
        );
        if (proxyHost == null) {
            return null;
        }

        sweepExpiredStreams();
        enforceStreamPoolCapacity(AUTHORIZED_STREAMS, false);
        String token = UUID.randomUUID().toString();
        String upstreamQuery = resource.getEncodedQuery();
        AUTHORIZED_STREAMS.put(token, new AuthorizedStream(
            binding,
            System.currentTimeMillis() + STREAM_CAPABILITY_TTL_MS,
            proxyHost,
            resource.getEncodedPath(),
            upstreamQuery,
            resource.toString(),
            null,
            null,
            shellStream ? StreamAudience.SHELL_STREAM : StreamAudience.APP_PROXY
        ));
        String safeMimeType = sanitizeResponseMimeType(mimeType);

        if (shellStream) {
            Uri.Builder shell = new Uri.Builder()
                .scheme("https")
                .encodedAuthority(SHELL_STREAM_HOST)
                .encodedPath(SHELL_STREAM_PATH)
                .appendQueryParameter(STREAM_CAPABILITY_QUERY_PARAM, token);
            if (safeMimeType != null) shell.appendQueryParameter(PROXY_MIME_QUERY_PARAM, safeMimeType);
            return shell.build().toString();
        }

        Uri.Builder proxy = resource.buildUpon()
            .scheme("https")
            .encodedAuthority(proxyHost)
            .fragment(null)
            .appendQueryParameter(STREAM_CAPABILITY_QUERY_PARAM, token);
        if (safeMimeType != null) proxy.appendQueryParameter(PROXY_MIME_QUERY_PARAM, safeMimeType);
        return proxy.build().toString();
    }

    static String authorizePrivateBytes(String dataBase64, String mimeType, String binding) {
        if (dataBase64 == null || binding == null || binding.trim().isEmpty()) return null;
        final byte[] bytes;
        try {
            bytes = Base64.decode(dataBase64, Base64.NO_WRAP);
        } catch (IllegalArgumentException error) {
            return null;
        }
        if (bytes.length < 1 || bytes.length > 1024 * 1024) {
            Arrays.fill(bytes, (byte) 0);
            return null;
        }
        sweepExpiredStreams();
        enforceStreamPoolCapacity(AUTHORIZED_STREAMS, true);
        String token = UUID.randomUUID().toString();
        String proxyHost = "private-" + token.substring(0, 8) + PROXY_HOST_SUFFIX;
        String proxyPath = "/home-v2-private-attachment";
        byte[] storedBytes = Arrays.copyOf(bytes, bytes.length);
        Arrays.fill(bytes, (byte) 0);
        AUTHORIZED_STREAMS.put(token, new AuthorizedStream(
            binding,
            System.currentTimeMillis() + STREAM_CAPABILITY_TTL_MS,
            proxyHost,
            proxyPath,
            null,
            null,
            storedBytes,
            sanitizeResponseMimeType(mimeType),
            StreamAudience.PRIVATE_BYTES
        ));
        return new Uri.Builder()
            .scheme("https")
            .encodedAuthority(proxyHost)
            .encodedPath(proxyPath)
            .appendQueryParameter(STREAM_CAPABILITY_QUERY_PARAM, token)
            .build()
            .toString();
    }

    static byte[] resolvePrivateStreamBytes(Uri url) {
        AuthorizedStream stream = getAuthorizedStream(url);
        return stream == null || stream.privateBytes == null
            ? null
            : Arrays.copyOf(stream.privateBytes, stream.privateBytes.length);
    }

    static String resolvePrivateStreamMimeType(Uri url) {
        AuthorizedStream stream = getAuthorizedStream(url);
        return stream == null ? null : stream.privateMimeType;
    }

    static void releaseStreams(String binding) {
        if (binding == null || binding.trim().isEmpty()) {
            for (AuthorizedStream stream : AUTHORIZED_STREAMS.values()) {
                if (stream.privateBytes != null) Arrays.fill(stream.privateBytes, (byte) 0);
            }
            AUTHORIZED_STREAMS.clear();
            return;
        }
        for (Map.Entry<String, AuthorizedStream> entry : AUTHORIZED_STREAMS.entrySet()) {
            if (binding.equals(entry.getValue().binding)) removeStream(entry.getKey());
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

        if (hasStreamCapabilityParameter(url)) {
            AuthorizedStream stream = getAuthorizedStream(url);
            return stream == null ? null : stream.upstreamUrl;
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
        if (hasStreamCapabilityParameter(url)) {
            return getAuthorizedStream(url) == null ? RouteKind.DENIED : RouteKind.RENDER;
        }
        AuthorizedOrigin authorization = getAuthorization(url);

        if (authorization == null) {
            return RouteKind.DENIED;
        }

        List<String> segments = url.getPathSegments();
        RouteKind route = classifyProxyPath(segments, url.getEncodedQuery(), authorization.homeV2);

        // Round 4/6: a Home v2 app tab's registered authorized document (see
        // authorize() and AppTabStage.tsx) is the ONLY resource this proxy will
        // serve APP-service RENDER or PUBLIC_ARBITRARY content for on this
        // origin — see isAuthorizedAppResource's doc comment. PUBLIC_ARBITRARY
        // is checked here too, not just RENDER — /arbitrary/APP/<name>/... can
        // return a full HTML document exactly like /render/... can (see
        // QdnBridgeWebViewClient.fetchUpstream's HTML-content-type bridge
        // injection), so without this an authorized tab could load ANOTHER
        // app's resource through /arbitrary and have it treated as data.
        if (
            (route == RouteKind.RENDER || route == RouteKind.PUBLIC_ARBITRARY)
                && authorization.homeV2
                && !isAuthorizedAppResource(
                    segments,
                    url.getQueryParameter("identifier"),
                    authorization.authorizedDocument,
                    authorization.hostingNetwork
                )
        ) {
            return RouteKind.DENIED;
        }

        return route;
    }

    /**
     * Round 4 (Sol re-review #2), unchanged in shape by round 6: whether an
     * APP-service RENDER or PUBLIC_ARBITRARY request resolves to the SAME app
     * resource (name + identifier) as the origin's registered {@link
     * AuthorizedDocument} — the containment that keeps an authorized tab from
     * loading, or reading via {@code /arbitrary}, another app's (or another
     * identifier's) files.
     *
     * <p>Round 6: this is no longer the security gate for whether a RENDER
     * document may carry the live signing/account-read bridge token — see
     * {@link #isExactAuthorizedRenderDocument} for that, which classifyProxyRoute
     * ALSO applies (independently — see that method) before a RENDER document
     * response is even served. This method now only decides the coarser
     * question "may this be served as DATA on this origin at all", which is
     * why it stays a name/identifier match rather than the full exact-URL
     * match: {@code /arbitrary} requests carry a completely different query
     * shape ({@code filepath=...}, not this proxy's reserved display params)
     * that exact-URL equality was never meant to apply to, and a RENDER
     * request for a deeper in-app sub-path of the SAME authorized app/
     * identifier (e.g. a hard, non-SPA navigation the app itself makes) is
     * still legitimately servable as plain, non-bridged content — it simply
     * will not equal the exact authorized document and so will never be
     * bridge-eligible (see isExactAuthorizedRenderDocument).
     *
     * <p>Round 6 ALSO deletes the old {@code initialPathname} exemption this
     * method used to carry: it existed only to paper over the ambiguity
     * between "a legitimate deep-linked sub-page" and "a spoofed identifier"
     * for the tab's own FIRST request, under the old identifier-only
     * comparison. The exact-URL match has no such ambiguity — the tab's own
     * first request's URL is, by construction, exactly the URL that was
     * registered (both are built from AppTabStage.tsx's {@code resolved.url})
     * — so the exemption is simply unnecessary now, not replaced by anything.
     */
    static boolean isAuthorizedAppResource(
        List<String> segments,
        String queryIdentifier,
        AuthorizedDocument authorized
    ) {
        return isAuthorizedAppResource(segments, queryIdentifier, authorized, "qortium");
    }

    static boolean isAuthorizedAppResource(
        List<String> segments,
        String queryIdentifier,
        AuthorizedDocument authorized,
        String hostingNetwork
    ) {
        // segments = [render|arbitrary, service, name, identifierOrPathSegment, ...].
        if (segments == null || segments.size() < 3 || !"APP".equalsIgnoreCase(segments.get(1))) {
            return true;
        }

        // Fail closed: a homeV2 origin serving APP render/arbitrary content
        // with no registered authorized document (authorize() was never
        // called with one, or the tab has not fully launched yet) has nothing
        // to check against.
        if (authorized == null || authorized.name == null) {
            return false;
        }

        if (!authorized.name.equals(segments.get(2))) {
            return false;
        }

        String candidateIdentifier = resolveCandidateIdentifier(segments, queryIdentifier, hostingNetwork);

        return authorized.identifier == null
            ? candidateIdentifier == null
            : authorized.identifier.equals(candidateIdentifier);
    }

    /**
     * Round 6: the actual security gate for the live signing/account-read
     * bridge token and script injection —
     * {@link org.qortium.home.QdnBridgeWebViewClient#shouldCarryBridgeToken}
     * uses this directly (and {@code shouldOverrideUrlLoading} uses it to
     * refuse the doomed navigation outright so it never even loads).
     *
     * <p>Ends the identifier-confusion class rounds 2-5 kept re-surfacing
     * variants of (a client-side {@code isRealIdentifier} approximation can
     * never be made perfect — Core's is server-only): a RENDER document
     * request is bridge-eligible if, and ONLY if, its normalized (pathname,
     * filtered-and-sorted query) exactly equals the registered {@link
     * AuthorizedDocument}'s. There is no separate name/identifier comparison,
     * no path-segment-vs-query ambiguity, and no initial-request exemption to
     * get wrong — the tab's own legitimate first load passes trivially
     * because both sides are built from the SAME trusted {@code resolved.url}
     * (see AppTabStage.tsx), and ANY other document — a different identifier
     * via path or query, a different app entirely, a non-APP service, or the
     * SAME app/identifier's own deeper in-app sub-route reached by a hard
     * (non-SPA) navigation — fails the comparison and gets neither the token
     * nor injection, regardless of how "close" it looks to the authorized
     * resource. CSP remains independently enforced for both eligible and
     * ineligible documents.
     *
     * <p>{@link #normalizeQuery} ignores exactly the query params that can
     * never distinguish one app resource from another (this proxy's own
     * reserved display params, and the bridge token param itself) and nothing
     * else — an unexpected extra query param the registered URL does not have
     * fails the match (fail closed), even if this proxy cannot prove that
     * param actually changes what Core serves.
     */
    static boolean isExactAuthorizedRenderDocument(
        List<String> segments,
        String encodedQuery,
        AuthorizedDocument authorized
    ) {
        if (authorized == null || authorized.name == null) {
            return false;
        }

        return authorized.pathname.equals(normalizePathnameFromSegments(segments))
            && authorized.query.equals(normalizeQuery(encodedQuery));
    }

    /**
     * Round 6: builds an {@link AuthorizedDocument} from a render path's
     * segments and raw (percent-encoded) query — the SAME shape {@link
     * #classifyProxyPath} and {@link #resolveCandidateIdentifier} already take,
     * kept dependency-free of {@code android.net.Uri} so it is directly unit
     * testable in this plain-JVM test environment (see
     * QdnRenderProxyTest — {@code android.net.Uri} throws at runtime there; no
     * Robolectric is configured). {@link #parseAuthorizedDocument} is the
     * {@code Uri}/String-typed production wrapper used by {@link #authorize}.
     */
    static AuthorizedDocument buildAuthorizedDocument(List<String> segments, String encodedQuery) {
        return buildAuthorizedDocument(segments, encodedQuery, "qortium");
    }

    static AuthorizedDocument buildAuthorizedDocument(
        List<String> segments,
        String encodedQuery,
        String hostingNetwork
    ) {
        String pathname = normalizePathnameFromSegments(segments);
        String query = normalizeQuery(encodedQuery);
        String name = null;
        String identifier = null;

        if (
            segments != null &&
                segments.size() >= 3 &&
                "render".equals(segments.get(0)) &&
                "APP".equalsIgnoreCase(segments.get(1))
        ) {
            name = segments.get(2);
            identifier = resolveCandidateIdentifier(
                segments,
                extractQueryParam(encodedQuery, "identifier"),
                hostingNetwork
            );
        }

        return new AuthorizedDocument(pathname, query, name, identifier);
    }

    /**
     * Production ({@code Uri}/String-typed) entry point for {@link
     * #buildAuthorizedDocumentIfOriginMatches}, used by {@link #authorize}.
     * Returns null for a blank/unparseable URL; see that method for the
     * origin check this delegates to.
     */
    static AuthorizedDocument parseAuthorizedDocument(String expectedOrigin, String authorizedDocumentUrl) {
        return parseAuthorizedDocument(expectedOrigin, authorizedDocumentUrl, "qortium");
    }

    static AuthorizedDocument parseAuthorizedDocument(
        String expectedOrigin,
        String authorizedDocumentUrl,
        String hostingNetwork
    ) {
        if (authorizedDocumentUrl == null || authorizedDocumentUrl.trim().isEmpty()) {
            return null;
        }

        Uri parsed = Uri.parse(authorizedDocumentUrl.trim());

        return buildAuthorizedDocumentIfOriginMatches(
            expectedOrigin,
            parsed.getScheme(),
            parsed.getHost(),
            parsed.getPort(),
            parsed.getPathSegments(),
            parsed.getEncodedQuery(),
            hostingNetwork
        );
    }

    /**
     * Round 7 (Sol round-6 re-review, bug 2): the origin-check half of
     * {@link #parseAuthorizedDocument}, split out — like {@link
     * #buildAuthorizedDocument} is split from it for the same reason — so it
     * is directly unit testable without {@code android.net.Uri} (unusable in
     * this plain-JVM test environment; see {@link #buildAuthorizedDocument}'s
     * doc comment). Returns null when the document's OWN origin (built from
     * {@code documentScheme}/{@code documentHost}/{@code documentPort} via
     * the SAME {@link #canonicalizeOrigin} canonicalization {@link
     * #normalizeOrigin} applies to the origin being authorized) does not
     * equal {@code expectedOrigin} — a caller bug passing a document URL for
     * a DIFFERENT node than the one it is registering against must never
     * silently authorize the wrong node's content; failing closed (no
     * authorized document at all, so {@link #isExactAuthorizedRenderDocument}
     * and {@link #isAuthorizedAppResource} both refuse everything) is safer
     * than trusting either value alone.
     *
     * <p>This class's doc comments previously claimed this check without
     * actually performing it — the document URL was parsed and used
     * unconditionally, so any caller bug (or a document URL for a different
     * node entirely) was silently trusted.
     */
    static AuthorizedDocument buildAuthorizedDocumentIfOriginMatches(
        String expectedOrigin,
        String documentScheme,
        String documentHost,
        int documentPort,
        List<String> segments,
        String encodedQuery
    ) {
        return buildAuthorizedDocumentIfOriginMatches(
            expectedOrigin,
            documentScheme,
            documentHost,
            documentPort,
            segments,
            encodedQuery,
            "qortium"
        );
    }

    static AuthorizedDocument buildAuthorizedDocumentIfOriginMatches(
        String expectedOrigin,
        String documentScheme,
        String documentHost,
        int documentPort,
        List<String> segments,
        String encodedQuery,
        String hostingNetwork
    ) {
        String documentOrigin = canonicalizeOrigin(documentScheme, documentHost, documentPort);

        if (expectedOrigin == null || documentOrigin == null || !documentOrigin.equals(expectedOrigin)) {
            return null;
        }

        return buildAuthorizedDocument(segments, encodedQuery, hostingNetwork);
    }

    /**
     * Round 6: thin {@link Uri}-typed accessor to the registered origin's
     * {@link AuthorizedDocument}, for {@link
     * org.qortium.home.QdnBridgeWebViewClient} call sites that only have the
     * request URL — mirrors {@link #isHomeV2Origin}'s existing pattern.
     */
    static AuthorizedDocument getAuthorizedDocument(Uri url) {
        AuthorizedOrigin authorization = getAuthorization(url);

        return authorization == null ? null : authorization.authorizedDocument;
    }

    /**
     * Round 6: builds the pathname half of the normalized document identity
     * from already-decoded path segments — {@code android.net.Uri.getPathSegments()}
     * (production requests) and this class's own test literals both hand this
     * function already-decoded strings, so no further decoding happens here;
     * joining them back with {@code '/'} is what gives "treat a trailing
     * slash consistently" for free (a trailing slash never produces a
     * trailing empty segment either side).
     */
    private static String normalizePathnameFromSegments(List<String> segments) {
        if (segments == null || segments.isEmpty()) {
            return "/";
        }

        StringBuilder pathname = new StringBuilder();

        for (String segment : segments) {
            pathname.append('/').append(segment);
        }

        return pathname.toString();
    }

    /**
     * Round 7 (Sol round-6 re-review, bug 1): the query half of the
     * normalized document identity — a canonical, sorted {@code
     * "key=value&key=value"} string built from a raw (percent-encoded)
     * query, WITHOUT decoding any retained key or value into the delimiter
     * space ({@code '&'}/{@code '='}). Only the KEY of each pair is decoded,
     * and only transiently, to decide whether that pair is one of {@link
     * #IGNORED_DOCUMENT_QUERY_PARAMS} — the pair itself (raw key AND raw
     * value, exactly as it appeared in the original query string) is what
     * gets kept, sorted, and rejoined.
     *
     * <p>The previous revision decoded every retained value too and rejoined
     * with a literal {@code '&'}/{@code '='}, which was not injective: a
     * single param {@code a=1%26b%3D2} (one pair, value {@code "1&b=2"})
     * decoded and rejoined to the exact same string, {@code "a=1&b=2"}, as
     * the genuinely two-param query {@code a=1&b=2}. Two different candidate
     * URLs must never normalize equal — that would let a candidate whose raw
     * query differs from the registered one still pass the exact-URL gate.
     * Keeping retained pairs raw (undecoded) means a percent-encoded
     * delimiter byte in a value can never masquerade as a real delimiter in
     * the canonical string, so this collision cannot occur; sorting the raw
     * pairs (rather than decoded key=value strings) keeps the comparison
     * order-independent while preserving that same guarantee. A repeated raw
     * key is still kept as multiple sorted entries rather than collapsed, so
     * a smuggled duplicate still shows up as a difference if the registered
     * URL never had one.
     */
    private static String normalizeQuery(String encodedQuery) {
        if (encodedQuery == null || encodedQuery.isEmpty()) {
            return "";
        }

        List<String> rawPairs = new ArrayList<>();

        for (String pair : encodedQuery.split("&")) {
            if (pair.isEmpty()) {
                continue;
            }

            int separator = pair.indexOf('=');
            String rawKey = separator >= 0 ? pair.substring(0, separator) : pair;
            String key = percentDecode(rawKey);

            if (IGNORED_DOCUMENT_QUERY_PARAMS.contains(key)) {
                continue;
            }

            // The pair is kept EXACTLY as it appeared in the raw query — no
            // decoding of the retained key or value — so encoded delimiter
            // bytes (%26/%3D) stay distinct from literal &/= in the
            // canonical string built below.
            rawPairs.add(pair);
        }

        Collections.sort(rawPairs);

        return String.join("&", rawPairs);
    }

    /** Round 6: decodes a single raw query key or value out of an encoded query string. */
    private static String extractQueryParam(String encodedQuery, String targetKey) {
        if (encodedQuery == null || encodedQuery.isEmpty()) {
            return null;
        }

        for (String pair : encodedQuery.split("&")) {
            if (pair.isEmpty()) {
                continue;
            }

            int separator = pair.indexOf('=');
            String rawKey = separator >= 0 ? pair.substring(0, separator) : pair;

            if (!targetKey.equals(percentDecode(rawKey))) {
                continue;
            }

            String rawValue = separator >= 0 ? pair.substring(separator + 1) : "";

            return percentDecode(rawValue);
        }

        return null;
    }

    /**
     * Round 6: the ONE decode function used for both sides of the exact-URL
     * comparison (the registered authorized URL, parsed via {@code
     * android.net.Uri}, and every actual proxied request, also via {@code
     * android.net.Uri}) — {@code URLDecoder} (form/query decoding, where
     * {@code '+'} is a space) rather than raw percent-decoding, because
     * AppTabStage.tsx's resolveRender builds this proxy's query strings with
     * {@code URLSearchParams#toString()}, which encodes a literal space as
     * {@code '+'}. What matters for this comparison is that BOTH sides decode
     * identically, not which encoding standard is "more correct" in general.
     */
    private static String percentDecode(String value) {
        try {
            return URLDecoder.decode(value, StandardCharsets.UTF_8.name());
        } catch (UnsupportedEncodingException | IllegalArgumentException ignored) {
            return value;
        }
    }

    /**
     * Round 6: thin {@link Uri}-typed accessor to the registered origin's
     * {@code homeV2} flag, for {@link
     * org.qortium.home.QdnBridgeWebViewClient} call sites that only have the
     * request URL — the pure decisions themselves live in {@link
     * #isExactAuthorizedRenderDocument} and {@link #isAuthorizedAppResource},
     * which take the flag directly so they stay unit-testable without a
     * {@link Uri} (this environment's plain JVM unit tests cannot construct a
     * working {@code android.net.Uri} — see this class's other {@code
     * List<String> segments}-based methods, all deliberately shaped the same
     * way).
     */
    static boolean isHomeV2Origin(Uri url) {
        AuthorizedOrigin authorization = getAuthorization(url);

        return authorization != null && authorization.homeV2;
    }

    /**
     * Resolves the candidate identifier for a RENDER or PUBLIC_ARBITRARY
     * path's segments exactly
     * the way Core's RenderResource.getPathByName resolves it — mirrors
     * electron/qdn-resource-identity.ts's resolveCandidateIdentifier and
     * src/v2/shell/render-path-identity.ts's twin: an explicit {@code
     * identifier} query parameter wins when non-blank for render paths;
     * Qortal arbitrary paths use their explicit path identifier and ignore
     * unrelated query parameters. Otherwise a
     * non-"default" (case-insensitive) first path segment after the name is
     * a POSSIBLE identifier. This proxy cannot verify a segment is a REAL
     * published identifier the way Core's isRealIdentifier does, so it fails
     * closed and treats ANY non-default first segment as one.
     */
    static String resolveCandidateIdentifier(List<String> segments, String queryIdentifier) {
        return resolveCandidateIdentifier(segments, queryIdentifier, "qortium");
    }

    static String resolveCandidateIdentifier(
        List<String> segments,
        String queryIdentifier,
        String hostingNetwork
    ) {
        // Qortal's /arbitrary/APP/<name>/<identifier> endpoint has a
        // path-bound identity. Its query parameters describe the data read
        // and must not override the identifier in the path (unlike
        // /render/APP/<name>, where RenderResource passes ?identifier to the
        // renderer). Keep this branch before render query handling so a
        // conflicting query cannot authorize another resource.
        if ("qortal".equalsIgnoreCase(hostingNetwork)
            && segments != null
            && !segments.isEmpty()
            && "arbitrary".equalsIgnoreCase(segments.get(0))) {
            if (segments.size() < 4) {
                return null;
            }
            String candidate = segments.get(3);
            return candidate.isEmpty() || "default".equalsIgnoreCase(candidate) ? null : candidate;
        }

        if (queryIdentifier != null && !queryIdentifier.trim().isEmpty()) {
            if ("qortal".equalsIgnoreCase(hostingNetwork)
                && segments != null
                && !segments.isEmpty()
                && "render".equalsIgnoreCase(segments.get(0))
                && "default".equalsIgnoreCase(queryIdentifier.trim())) {
                return null;
            }
            return queryIdentifier;
        }

        // Qortal's RenderResource passes every path segment after APP/name as
        // inPath; only its `identifier` query parameter selects a named
        // resource. Qortium retains its path-based identifier convention.
        if ("qortal".equalsIgnoreCase(hostingNetwork)
            && segments != null
            && !segments.isEmpty()
            && "render".equalsIgnoreCase(segments.get(0))) {
            return null;
        }

        if (segments != null && segments.size() >= 4) {
            String candidate = segments.get(3);

            if (!candidate.isEmpty() && !"default".equalsIgnoreCase(candidate)) {
                return candidate;
            }
        }

        return null;
    }

    private static String normalizeHostingNetwork(String hostingNetwork) {
        if (hostingNetwork == null) {
            return null;
        }

        String normalized = hostingNetwork.trim().toLowerCase(Locale.ROOT);

        return "qortal".equals(normalized) || "qortium".equals(normalized) ? normalized : null;
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

    /**
     * Returns the canonical proxy host from a candidate app origin. This is a
     * shape check only; callers must still check the host against the
     * authorized-origin table before using it as a capability audience.
     */
    static String getAppProxyHost(String appOrigin) {
        if (appOrigin == null || appOrigin.trim().isEmpty()) {
            return null;
        }

        final URI parsed;
        try {
            parsed = new URI(appOrigin.trim());
        } catch (URISyntaxException ignored) {
            return null;
        }

        if (
            !"https".equalsIgnoreCase(parsed.getScheme()) ||
            parsed.getHost() == null ||
            parsed.getPort() != -1 ||
            parsed.getUserInfo() != null ||
            parsed.getQuery() != null ||
            parsed.getFragment() != null ||
            (parsed.getPath() != null && !parsed.getPath().isEmpty() && !"/".equals(parsed.getPath()))
        ) {
            return null;
        }

        String host = parsed.getHost().toLowerCase(Locale.ROOT);
        if (host.length() <= PROXY_HOST_SUFFIX.length() || !host.endsWith(PROXY_HOST_SUFFIX)) {
            return null;
        }

        return host;
    }

    static boolean isAuthorizedHomeV2ProxyHost(String proxyHost) {
        if (proxyHost == null || proxyHost.length() <= PROXY_HOST_SUFFIX.length()) {
            return false;
        }

        String normalizedHost = proxyHost.toLowerCase(Locale.ROOT);
        if (!normalizedHost.endsWith(PROXY_HOST_SUFFIX)) {
            return false;
        }

        AuthorizedOrigin authorization = AUTHORIZED_ORIGINS.get(
            normalizedHost.substring(0, normalizedHost.length() - PROXY_HOST_SUFFIX.length())
        );
        return authorization != null && authorization.homeV2;
    }

    /** Pure selection rule used by authorizeStream and JVM tests. */
    static String selectStreamCapabilityHost(
        String defaultProxyHost,
        String appOrigin,
        String registeredAppProxyHost,
        boolean registeredHomeV2,
        boolean shellStream
    ) {
        if (appOrigin == null) {
            return defaultProxyHost;
        }
        if (shellStream || !registeredHomeV2 || registeredAppProxyHost == null) {
            return null;
        }

        String candidateHost = getAppProxyHost(appOrigin);
        return candidateHost != null && candidateHost.equalsIgnoreCase(registeredAppProxyHost)
            ? candidateHost
            : null;
    }

    /**
     * The raw-byte stream capability is intentionally narrower than the
     * ordinary PUBLIC_ARBITRARY proxy route. Home uses it for FILE/FILES
     * resources whose bytes are served by Core's /arbitrary endpoint. A
     * capability minted for an arbitrary DOCUMENT, APP, search, metadata, or
     * malformed coordinate would turn that response into a stable proxy URL
     * without the route's normal app/resource checks.
     */
    static boolean isAllowedRawByteResourcePath(List<String> segments, String encodedQuery) {
        if (segments == null || (segments.size() != 3 && segments.size() != 4)) {
            return false;
        }

        if (!"arbitrary".equalsIgnoreCase(segments.get(0))) {
            return false;
        }

        String service = segments.get(1);
        if (!"FILE".equalsIgnoreCase(service) && !"FILES".equalsIgnoreCase(service)) {
            return false;
        }

        for (int index = 2; index < segments.size(); index += 1) {
            if (segments.get(index) == null || segments.get(index).isEmpty()
                || ".".equals(segments.get(index)) || "..".equals(segments.get(index))) {
                return false;
            }
        }

        return hasSafeFilepathQuery(encodedQuery);
    }

    /** Reject traversal hidden behind one or more layers of URL encoding. */
    private static boolean hasSafeFilepathQuery(String encodedQuery) {
        if (encodedQuery == null || encodedQuery.isEmpty()) {
            return true;
        }

        int filepathCount = 0;

        for (String pair : encodedQuery.split("&", -1)) {
            int separator = pair.indexOf('=');
            String rawKey = separator >= 0 ? pair.substring(0, separator) : pair;
            String key = strictPercentDecode(rawKey);
            if (key == null) {
                return false;
            }
            if (!"filepath".equalsIgnoreCase(key)) {
                continue;
            }

            filepathCount += 1;
            if (filepathCount > 1) {
                return false;
            }

            String decoded = separator >= 0 ? pair.substring(separator + 1) : "";
            // Decode repeatedly so %2e%2e%2f and %252e%252e%252f are both
            // treated as traversal. If a value keeps changing beyond the
            // bound, reject it rather than allowing an unexamined encoding
            // layer through to Core.
            for (int round = 0; round < 8; round += 1) {
                if (containsDotTraversal(decoded)) {
                    return false;
                }
                String next = strictPercentDecode(decoded);
                if (next == null) {
                    // A literal percent in an already decoded filename is
                    // valid; malformed encoding in the actual query is not.
                    if (round == 0) return false;
                    break;
                }
                if (next.equals(decoded)) {
                    break;
                }
                decoded = next;
                if (round == 7) {
                    String afterBound = strictPercentDecode(next);
                    return afterBound != null && afterBound.equals(next)
                        && !containsDotTraversal(next);
                }
            }

            if (containsDotTraversal(decoded)) {
                return false;
            }
        }

        return true;
    }

    private static boolean containsDotTraversal(String value) {
        if (value == null || value.startsWith("/") || value.indexOf('\\') >= 0) {
            return true;
        }
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            if (character < 0x20 || character == 0x7f) {
                return true;
            }
        }
        for (String segment : value.split("/", -1)) {
            if (".".equals(segment) || "..".equals(segment)) {
                return true;
            }
        }
        return false;
    }

    private static String strictPercentDecode(String value) {
        try {
            return URLDecoder.decode(value, StandardCharsets.UTF_8.name());
        } catch (UnsupportedEncodingException | IllegalArgumentException ignored) {
            return null;
        }
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
        if (!isProxyUrl(url) && !isShellStreamUrl(url)) {
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
        String encodedStreamPrefix = STREAM_CAPABILITY_QUERY_PARAM + "=";
        StringBuilder upstreamQuery = new StringBuilder();

        for (String parameter : encodedQuery.split("&")) {
            if (
                parameter.equals(PROXY_MIME_QUERY_PARAM) ||
                parameter.startsWith(encodedProxyMimePrefix) ||
                parameter.equals(STREAM_CAPABILITY_QUERY_PARAM) ||
                parameter.startsWith(encodedStreamPrefix)
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

    static boolean isStreamCapabilityUrl(Uri url) {
        return getAuthorizedStream(url) != null || getAuthorizedShellStream(url) != null;
    }

    /**
     * The shell-origin stream route shape: exactly the fixed path on the
     * shell's own https origin with a single capability token. Everything
     * else about the request is decided by the token's stored authorization,
     * never by the URL.
     */
    static boolean isShellStreamUrl(Uri url) {
        return url != null &&
            "https".equals(url.getScheme()) &&
            SHELL_STREAM_HOST.equals(url.getHost()) &&
            url.getPort() == -1 &&
            SHELL_STREAM_PATH.equals(url.getPath()) &&
            url.getUserInfo() == null &&
            url.getQueryParameters(STREAM_CAPABILITY_QUERY_PARAM).size() == 1;
    }

    private static AuthorizedStream getAuthorizedShellStream(Uri url) {
        if (!isShellStreamUrl(url)) return null;
        List<String> tokens = url.getQueryParameters(STREAM_CAPABILITY_QUERY_PARAM);
        if (tokens.size() != 1) return null;
        AuthorizedStream stream = AUTHORIZED_STREAMS.get(tokens.get(0));
        if (stream == null) return null;
        // ONLY tokens minted for the shell route serve here. An app's own
        // APP_PROXY (or PRIVATE_BYTES) token must never be redeemable on the
        // shell origin — otherwise an app could point its own stream token at
        // attacker HTML and top-navigate https://localhost to it.
        if (stream.audience != StreamAudience.SHELL_STREAM) return null;
        if (stream.expiresAt <= System.currentTimeMillis()) {
            removeStream(tokens.get(0));
            return null;
        }
        return stream;
    }

    /**
     * The exact upstream render URL the shell-route token was authorized for,
     * or null when the token is unknown, expired, or names a private-bytes
     * stream — the shell viewer never mints those, so the route refuses them
     * rather than growing a second serving path.
     */
    static String resolveShellStreamUpstreamUrl(Uri url) {
        AuthorizedStream stream = getAuthorizedShellStream(url);
        if (stream == null || stream.privateBytes != null || stream.upstreamUrl == null) return null;
        return stream.upstreamUrl;
    }

    private static AuthorizedStream getAuthorizedStream(Uri url) {
        if (!isProxyUrl(url)) return null;
        List<String> tokens = url.getQueryParameters(STREAM_CAPABILITY_QUERY_PARAM);
        if (tokens.size() != 1) return null;
        AuthorizedStream stream = AUTHORIZED_STREAMS.get(tokens.get(0));
        if (stream == null) return null;
        if (stream.expiresAt <= System.currentTimeMillis()) {
            removeStream(tokens.get(0));
            return null;
        }
        // A shell-route token is not redeemable on the app proxy origin (and
        // vice versa via getAuthorizedShellStream): the audience is fixed at
        // mint and must match the route.
        if (stream.audience == StreamAudience.SHELL_STREAM) return null;
        if (
            !stream.proxyHost.equalsIgnoreCase(url.getHost()) ||
            !stream.proxyPath.equals(url.getEncodedPath()) ||
            !equalNullable(stream.upstreamQuery, getUpstreamEncodedQuery(url.getEncodedQuery()))
        ) {
            return null;
        }
        return stream;
    }

    private static boolean hasStreamCapabilityParameter(Uri url) {
        return isProxyUrl(url) && !url.getQueryParameters(STREAM_CAPABILITY_QUERY_PARAM).isEmpty();
    }

    private static boolean equalNullable(String left, String right) {
        return left == null ? right == null : left.equals(right);
    }

    private static void sweepExpiredStreams() {
        long now = System.currentTimeMillis();
        for (Map.Entry<String, AuthorizedStream> entry : AUTHORIZED_STREAMS.entrySet()) {
            if (entry.getValue().expiresAt <= now) removeStream(entry.getKey());
        }
    }

    private static void removeStream(String token) {
        removeStream(AUTHORIZED_STREAMS, token);
    }

    private static void removeStream(Map<String, AuthorizedStream> streams, String token) {
        AuthorizedStream removed = streams.remove(token);
        if (removed != null && removed.privateBytes != null) Arrays.fill(removed.privateBytes, (byte) 0);
    }

    /**
     * Enforces one capability quota without allowing one pool to evict the
     * other. URL-only streams carry no private bytes and may use a larger
     * metadata quota; private-byte streams retain the 64-entry memory bound.
     * Ties are broken by token so eviction is deterministic despite the
     * backing ConcurrentHashMap's iteration order.
     */
    static void enforceStreamPoolCapacity(Map<String, AuthorizedStream> streams, boolean privatePool) {
        int maximum = privatePool
            ? PRIVATE_STREAM_CAPABILITY_MAX_ENTRIES
            : UPSTREAM_STREAM_CAPABILITY_MAX_ENTRIES;

        while (countStreamPool(streams, privatePool) >= maximum) {
            String oldest = oldestStreamToken(streams, privatePool);
            if (oldest == null) {
                return;
            }
            removeStream(streams, oldest);
        }
    }

    private static int countStreamPool(Map<String, AuthorizedStream> streams, boolean privatePool) {
        int count = 0;
        for (AuthorizedStream stream : streams.values()) {
            if (isPrivateStream(stream) == privatePool) {
                count += 1;
            }
        }
        return count;
    }

    private static String oldestStreamToken(Map<String, AuthorizedStream> streams, boolean privatePool) {
        String oldestToken = null;
        long oldestExpiry = Long.MAX_VALUE;

        for (Map.Entry<String, AuthorizedStream> entry : streams.entrySet()) {
            if (isPrivateStream(entry.getValue()) != privatePool) {
                continue;
            }
            long expiresAt = entry.getValue().expiresAt;
            if (
                oldestToken == null ||
                expiresAt < oldestExpiry ||
                (expiresAt == oldestExpiry && entry.getKey().compareTo(oldestToken) < 0)
            ) {
                oldestToken = entry.getKey();
                oldestExpiry = expiresAt;
            }
        }

        return oldestToken;
    }

    private static boolean isPrivateStream(AuthorizedStream stream) {
        return stream != null && stream.privateBytes != null;
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

        return canonicalizeOrigin(parsed.getScheme(), parsed.getHost(), parsed.getPort());
    }

    /**
     * Round 7 (Sol round-6 re-review, bug 2): the pure scheme/host/port
     * canonicalization {@link #normalizeOrigin} (the origin being
     * authorized) and {@link #buildAuthorizedDocumentIfOriginMatches} (the
     * authorized document's OWN origin) both build their comparable origin
     * string from — kept as one function so the two can never drift apart on
     * what "the same origin" means (a lowercase scheme/host, explicit port
     * only when one was present).
     */
    private static String canonicalizeOrigin(String scheme, String host, int port) {
        if (scheme == null || host == null) {
            return null;
        }

        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
            return null;
        }

        String normalized = scheme.toLowerCase(Locale.ROOT) + "://" + host.toLowerCase(Locale.ROOT);

        return port == -1 ? normalized : normalized + ":" + port;
    }
}
