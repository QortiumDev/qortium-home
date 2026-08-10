package org.qortium.home;

import android.net.Uri;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HashSet;
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

    private static final Map<String, String> AUTHORIZED_ORIGINS = new ConcurrentHashMap<>();
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
    static String authorize(String origin) {
        String normalizedOrigin = normalizeOrigin(origin);

        if (normalizedOrigin == null) {
            return null;
        }

        String label = getLabel(normalizedOrigin);

        AUTHORIZED_ORIGINS.put(label, normalizedOrigin);

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
        String origin = AUTHORIZED_ORIGINS.get(label);

        if (origin == null) {
            return null;
        }

        java.util.List<String> segments = url.getPathSegments();

        if (!isAllowedProxyPath(segments)) {
            return null;
        }

        StringBuilder upstream = new StringBuilder(origin);

        for (String segment : segments) {
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

    /**
     * Q-Apps commonly use same-origin relative GETs for public QDN resources.
     * Keep those reads on the already-authorized node while refusing every
     * other Core API family (admin, transactions, cross-chain, and so on).
     */
    static boolean isAllowedProxyPath(java.util.List<String> segments) {
        if (segments == null || segments.size() < 2) {
            return false;
        }

        for (String segment : segments) {
            if (".".equals(segment) || "..".equals(segment)) {
                return false;
            }
        }

        if ("arbitrary".equals(segments.get(0))) {
            return true;
        }

        return
            segments.size() >= 3 &&
            "render".equals(segments.get(0)) &&
            ALLOWED_RENDER_SERVICES.contains(segments.get(1).toUpperCase(Locale.ROOT));
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
