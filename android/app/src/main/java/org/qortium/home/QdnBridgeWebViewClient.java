package org.qortium.home;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class QdnBridgeWebViewClient extends BridgeWebViewClient {

    private static final int REQUEST_TIMEOUT_MS = 30000;
    static final int TRANSACTION_RESPONSE_MAX_BYTES = 512 * 1024;
    static final long RESOURCE_STREAM_RESPONSE_MAX_BYTES = 512L * 1024L * 1024L;
    static final long RESOURCE_STREAM_TOTAL_MAX_BYTES = 4L * 1024L * 1024L * 1024L;
    // Round 6: moved to QdnRenderProxy so its exact-URL document-identity
    // normalization (which must ignore this exact param) and this class's own
    // use of it as the actual carried credential can never drift apart — see
    // QdnRenderProxy.QDN_BRIDGE_TOKEN_QUERY_PARAM's doc comment.
    private static final String QDN_BRIDGE_QUERY_PARAM = QdnRenderProxy.QDN_BRIDGE_TOKEN_QUERY_PARAM;
    private static final Pattern CONTENT_RANGE_PATTERN =
        Pattern.compile("^bytes\\s+(\\d+)-(\\d+)/(\\d+|\\*)$", Pattern.CASE_INSENSITIVE);

    public QdnBridgeWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        // Proxied QDN requests are checked first: they use a host Capacitor does not
        // know, and its fallback would answer them with the app shell.
        if (request != null && QdnRenderProxy.isProxyUrl(request.getUrl())) {
            return serveProxiedQdnRequest(request);
        }

        WebResourceResponse capacitorResponse = super.shouldInterceptRequest(view, request);

        if (capacitorResponse != null) {
            return capacitorResponse;
        }

        if (!shouldInjectQdnBridge(request)) {
            return null;
        }

        try {
            return fetchAndInjectQdnBridge(request);
        } catch (IOException ignored) {
            return null;
        }
    }

    /**
     * Serves a request made against the QDN proxy origin from the node the view's
     * token was authorized for. An unauthorized token is refused rather than
     * passed through, so the proxy can never reach an origin Home did not choose.
     */
    private WebResourceResponse serveProxiedQdnRequest(WebResourceRequest request) {
        if (!isAllowedProxyMethod(request.getMethod())) {
            return forbiddenResponse();
        }

        QdnRenderProxy.RouteKind route = QdnRenderProxy.classifyProxyRoute(request.getUrl());

        if (route == QdnRenderProxy.RouteKind.HOME_V2_BRIDGE_CLIENT) {
            return emptyHomeV2BridgeClientResponse();
        }

        if (route == QdnRenderProxy.RouteKind.DENIED) {
            return forbiddenResponse();
        }

        String upstreamUrl = QdnRenderProxy.resolveUpstreamUrl(request.getUrl());

        if (upstreamUrl == null) {
            return forbiddenResponse();
        }

        try {
            // The bridge token still travels in the query, exactly as it does for a
            // direct render request; only the origin the page loads from changed.
            //
            // Round 4, Defect C (Sol round-3 re-review): only ever forwarded for a
            // RENDER response — the tab's own authorized top-level document — see
            // shouldCarryBridgeToken's doc comment for why a PUBLIC_ARBITRARY (or any
            // other) route must never receive it, even when
            // QdnRenderProxy.classifyProxyRoute has already scoped that request to
            // this tab's own resource.
            //
            // Round 6 (Sol round-5 re-review, ending the identifier-confusion class):
            // shouldCarryBridgeToken no longer compares identifiers at all for a homeV2
            // origin — see its doc comment for why the EXACT registered document URL is
            // now the whole gate.
            Uri requestUrl = request.getUrl();
            String bridgeToken = shouldCarryBridgeToken(
                route,
                QdnRenderProxy.isHomeV2Origin(requestUrl),
                requestUrl.getPathSegments(),
                requestUrl.getEncodedQuery(),
                QdnRenderProxy.getAuthorizedDocument(requestUrl)
            )
                ? requestUrl.getQueryParameter(QDN_BRIDGE_QUERY_PARAM)
                : null;

            return fetchUpstream(
                request,
                upstreamUrl,
                bridgeToken,
                route == QdnRenderProxy.RouteKind.TRANSACTION_SIGNATURE
                    ? TRANSACTION_RESPONSE_MAX_BYTES
                    : null
            );
        } catch (IOException ignored) {
            return null;
        }
    }

    /**
     * Round 4, Defect C (Sol round-3 re-review): whether a proxied response for
     * this route may carry the live signing/account-read bridge token — which
     * {@link #fetchUpstream} arms into ANY text/html response it sees a non-null,
     * non-empty token for (see its {@code isHtmlContentType} branch).
     *
     * <p>Only {@link QdnRenderProxy.RouteKind#RENDER} — the tab's own authorized
     * top-level app document, already bound to this tab's launch identity by
     * {@link QdnRenderProxy#classifyProxyRoute} — may. {@code PUBLIC_ARBITRARY} is
     * for DATA reads (FETCH_QDN_RESOURCE, GET_QDN_RESOURCE_STREAM_URL, and
     * similar; see electron/home-v2-app-actions.ts's buildHomeV2ResourcePath),
     * which an app can point at HTML content — its own or, before this fix,
     * another resource's — with no expectation that the response becomes a
     * bridge-armed document. Without this, ANY html-typed /arbitrary response
     * (same-resource or, before the classifyProxyRoute identity check above,
     * cross-resource) would be injected with a live qdnRequest/qortalRequest
     * bridge exactly as if it were this tab's own launched page.
     *
     * <p>Round 5, Defect C (Sol round-4 re-review): {@code
     * RouteKind.RENDER} alone was still not enough — it covers WEBSITE,
     * GAME, HASH, and the streamable media services exactly as it covers
     * APP (see {@code QdnRenderProxy.ALLOWED_RENDER_SERVICES} /
     * classifyProxyPath), and none of those legitimately carry a per-tab
     * identity to check (they are non-bridged sub-resource reads/embeds).
     * So a Home v2 app tab's iframe could self-navigate to
     * `/render/WEBSITE/<attacker>/...` (or GAME, or HASH) on this same
     * shared proxy origin — its own current location already carries the
     * token in the query, visible to page JS via {@code location.href}, so
     * no cooperation from the app was needed to bring it along — and (before
     * round 5) this method would still return {@code true} for that
     * RouteKind.RENDER route, arming the attacker's response with the live
     * signing/account-read bridge AND stripping its Content-Security-Policy
     * (both live in {@code fetchUpstream}'s same {@code bridgeToken != null}
     * branch), under the still-authorized APP identity.
     *
     * <p>Round 6 (owner-directed redesign, ending the round-2/4/5
     * identifier-confusion class): for a homeV2 origin, this no longer asks
     * "is the service APP" (round 5) or "does the name/identifier match"
     * (round 4/2) at all — both were approximations of "is this the tab's
     * own document" that a client-side identifier resolution can never make
     * perfectly (Core's {@code isRealIdentifier} is server-only). Instead it
     * asks the only question that actually matters: does this request's
     * normalized URL EQUAL the EXACT document the shell authorized (see
     * {@code QdnRenderProxy.isExactAuthorizedRenderDocument} and {@code
     * QdnRenderProxy.AuthorizedDocument}'s doc comments)? A WEBSITE/GAME/HASH
     * render, a different app, a different identifier via path OR query, or
     * even the SAME app/identifier's own deeper in-app sub-route reached by a
     * hard navigation, all fail this exact comparison and get neither the
     * token nor injection nor a stripped CSP — regardless of how "close" they
     * look. A v1 (non-{@code homeV2}) origin has no shared, per-tab document
     * to protect this way at all (see {@code QdnRenderProxy.authorize}'s
     * {@code authorizedDocumentUrl} parameter doc comment: each v1 proxy
     * origin is dedicated to the ONE resource the user explicitly opened), so
     * it keeps carrying the token for any RENDER service exactly as it always
     * has — unchanged by this fix.
     *
     * <p>Do not rely on the app's self-reported navigation (AppTabStage.tsx's
     * {@code liveResourcePathRef}/{@code isSameRenderResourcePath} check)
     * instead of this gate: that self-report only updates when the injected
     * bridge script's own navigation tracking runs, and a malicious page can
     * suppress it (e.g. a decoy `<!--<head>-->` earlier in its raw HTML
     * defeats {@link #injectQdnBridge}'s naive {@code indexOf("<head")}
     * locator, landing the injected script inside an HTML comment where it
     * never executes) while still hand-rolling the same
     * `window.parent.postMessage({type:'qortium:qdn-request',...})` wire
     * protocol itself — it needs no help from the injected script, only the
     * token (already visible to it) and this method having wrongly said the
     * response might be bridged. This method, and the CSP it therefore keeps
     * intact for a route it refuses, is the actual enforcement — see
     * AppTabStage.tsx's liveResourcePathRef doc comment for why, given this
     * gate, that self-report is now UX/consistency defense-in-depth rather
     * than a security boundary of its own.
     */
    static boolean shouldCarryBridgeToken(
        QdnRenderProxy.RouteKind route,
        boolean homeV2,
        List<String> segments,
        String encodedQuery,
        QdnRenderProxy.AuthorizedDocument authorizedDocument
    ) {
        if (route != QdnRenderProxy.RouteKind.RENDER) {
            return false;
        }

        return !homeV2 || QdnRenderProxy.isExactAuthorizedRenderDocument(segments, encodedQuery, authorizedDocument);
    }

    static boolean isAllowedProxyMethod(String method) {
        return "GET".equalsIgnoreCase(method);
    }

    private WebResourceResponse emptyHomeV2BridgeClientResponse() {
        Map<String, String> headers = new HashMap<>();

        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");

        return new WebResourceResponse(
            "application/javascript",
            StandardCharsets.UTF_8.name(),
            200,
            "OK",
            headers,
            new ByteArrayInputStream(new byte[0])
        );
    }

    private WebResourceResponse forbiddenResponse() {
        byte[] body = "QDN render proxy request was not authorized.".getBytes(StandardCharsets.UTF_8);
        Map<String, String> headers = new HashMap<>();

        headers.put("Cache-Control", "no-store");

        return new WebResourceResponse(
            "text/plain",
            StandardCharsets.UTF_8.name(),
            403,
            "Forbidden",
            headers,
            new ByteArrayInputStream(body)
        );
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (request == null || request.isForMainFrame()) {
            return super.shouldOverrideUrlLoading(view, request);
        }

        Uri url = request.getUrl();

        if (QdnRenderProxy.isProxyUrl(url)) {
            // Fix 2 (Sol re-review #2): cancel a subframe navigation this
            // proxy would refuse to serve anyway — classifyProxyRoute checks
            // a Home v2 app tab's registered authorized app resource for
            // APP-service RENDER/PUBLIC_ARBITRARY paths (see
            // QdnRenderProxy.isAuthorizedAppResource) — so the tab's iframe
            // never even starts loading a different app's content.
            // shouldInterceptRequest below independently enforces the same
            // check for every request this navigation check does not catch
            // (fetch/XHR/redirects/etc.), so this is a UX improvement (stay
            // on the current app instead of showing a blocked-request page)
            // layered on top of, not a substitute for, that enforcement.
            QdnRenderProxy.RouteKind route = QdnRenderProxy.classifyProxyRoute(url);

            if (route == QdnRenderProxy.RouteKind.DENIED) {
                return true;
            }

            // Round 5/6, Defect C (Sol round-4/5 re-review): also cancel a frame
            // navigation this origin would serve as DATA but never as this
            // tab's bridged principal — see shouldCarryBridgeToken's doc
            // comment for the full exploit (a homeV2 app tab's iframe
            // self-navigating to a different RENDER document on this same
            // shared origin) and for why round 6's exact-URL match cannot
            // break a legitimate embed, data read, or the tab's own initial
            // load. shouldInterceptRequest's own use of shouldCarryBridgeToken
            // already refuses the bridge/CSP-removal for this response even
            // without this check (that is the real enforcement — see this
            // class's shouldCarryBridgeToken doc comment for why the app's
            // own self-report can never be relied on instead); this is the
            // same "don't even start the doomed load" UX improvement as the
            // DENIED case above, layered on top of it. Reuses
            // shouldCarryBridgeToken directly rather than duplicating its
            // decision inline, so the two call sites can never drift apart.
            return route == QdnRenderProxy.RouteKind.RENDER
                && !shouldCarryBridgeToken(
                    route,
                    QdnRenderProxy.isHomeV2Origin(url),
                    url.getPathSegments(),
                    url.getEncodedQuery(),
                    QdnRenderProxy.getAuthorizedDocument(url)
                );
        }

        if (!isHttpScheme(url.getScheme())) {
            return true;
        }

        return !isQdnRenderUrl(url);
    }

    private boolean shouldInjectQdnBridge(WebResourceRequest request) {
        if (!"GET".equalsIgnoreCase(request.getMethod())) {
            return false;
        }

        Uri url = request.getUrl();

        if (!isQdnRenderUrl(url) || !hasValidBridgeToken(url)) {
            return false;
        }

        String accept = getRequestHeader(request, "Accept");

        return accept.isEmpty() || accept.toLowerCase(Locale.ROOT).contains("text/html");
    }

    private WebResourceResponse fetchAndInjectQdnBridge(WebResourceRequest request) throws IOException {
        return fetchUpstream(
            request,
            request.getUrl().toString(),
            request.getUrl().getQueryParameter(QDN_BRIDGE_QUERY_PARAM),
            null
        );
    }

    private WebResourceResponse fetchUpstream(
        WebResourceRequest request,
        String upstreamUrl,
        String bridgeToken,
        Integer maxBufferedBytes
    )
        throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(upstreamUrl).openConnection();

        connection.setConnectTimeout(REQUEST_TIMEOUT_MS);
        connection.setReadTimeout(REQUEST_TIMEOUT_MS);
        boolean streamCapability = QdnRenderProxy.isStreamCapabilityUrl(request.getUrl());
        connection.setInstanceFollowRedirects(!streamCapability);
        connection.setRequestMethod("GET");

        for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
            String name = header.getKey();

            if (
                name == null ||
                header.getValue() == null ||
                "Accept-Encoding".equalsIgnoreCase(name) ||
                "Host".equalsIgnoreCase(name)
            ) {
                continue;
            }

            connection.setRequestProperty(name, header.getValue());
        }

        connection.setRequestProperty("Accept-Encoding", "identity");

        int statusCode = connection.getResponseCode();
        if (streamCapability && statusCode >= 300 && statusCode < 400) {
            connection.disconnect();
            return forbiddenResponse();
        }
        String reasonPhrase = connection.getResponseMessage();
        String contentType = connection.getContentType();
        boolean inferredContentType = contentType == null || contentType.trim().isEmpty();

        if (inferredContentType) {
            contentType = QdnRenderProxy.resolveResponseMimeType(request.getUrl());
        }

        Map<String, String> responseHeaders = getResponseHeaders(connection);

        if (
            streamCapability &&
            (responseContentLengthExceeds(connection, RESOURCE_STREAM_RESPONSE_MAX_BYTES) ||
                getContentRangeTotal(responseHeaders) > RESOURCE_STREAM_TOTAL_MAX_BYTES)
        ) {
            connection.disconnect();
            return payloadTooLargeResponse();
        }

        if (inferredContentType && contentType != null) {
            responseHeaders.put("Content-Type", contentType);
        }

        InputStream responseStream = getResponseStream(connection, statusCode);
        InputStream deliveredStream = streamCapability
            ? new ByteLimitInputStream(responseStream, RESOURCE_STREAM_RESPONSE_MAX_BYTES)
            : responseStream;
        long responseContentLength = connection.getContentLengthLong();
        long virtualRangePrefixLength = getContentRangeStart(responseHeaders);

        if (maxBufferedBytes != null) {
            if (responseContentLength > maxBufferedBytes) {
                try {
                    responseStream.close();
                } catch (IOException ignored) {
                    // The size policy already rejected this body.
                } finally {
                    connection.disconnect();
                }
                return payloadTooLargeResponse();
            }

            byte[] responseBytes;

            try {
                responseBytes = readAllBytes(responseStream, maxBufferedBytes);
            } catch (ResponseTooLargeException error) {
                return payloadTooLargeResponse();
            } finally {
                connection.disconnect();
            }

            removeHeader(responseHeaders, "Content-Length");
            removeHeader(responseHeaders, "Content-Encoding");
            removeHeader(responseHeaders, "Transfer-Encoding");
            responseHeaders.put("Cache-Control", "no-store");

            if (contentType == null || contentType.trim().isEmpty()) {
                contentType = "application/json";
            }

            return new WebResourceResponse(
                getMimeType(contentType),
                getResponseEncoding(contentType),
                statusCode,
                reasonPhrase == null ? getReasonPhrase(statusCode) : reasonPhrase,
                responseHeaders,
                new ByteArrayInputStream(responseBytes)
            );
        }

        if (isHtmlContentType(contentType) && bridgeToken != null && !bridgeToken.isEmpty()) {
            Charset charset = getCharset(contentType);
            byte[] responseBytes;

            try {
                responseBytes = readAllBytes(responseStream);
            } finally {
                connection.disconnect();
            }

            String html = new String(responseBytes, charset);

            boolean homeV2Bridge = "1".equals(
                request.getUrl().getQueryParameter("homeV2Bridge")
            );
            responseBytes = injectQdnBridge(html, bridgeToken, homeV2Bridge).getBytes(charset);
            removeHeader(responseHeaders, "Content-Length");
            removeHeader(responseHeaders, "Content-Encoding");
            removeHeader(responseHeaders, "Transfer-Encoding");
            removeHeader(responseHeaders, "Content-Security-Policy");
            removeHeader(responseHeaders, "X-Content-Security-Policy");
            responseHeaders.put("Referrer-Policy", "no-referrer");

            return new WebResourceResponse(
                getMimeType(contentType),
                charset.name(),
                statusCode,
                reasonPhrase == null ? getReasonPhrase(statusCode) : reasonPhrase,
                responseHeaders,
                new ByteArrayInputStream(responseBytes)
            );
        }

        return new WebResourceResponse(
            getMimeType(contentType),
            getResponseEncoding(contentType),
            statusCode,
            reasonPhrase == null ? getReasonPhrase(statusCode) : reasonPhrase,
            responseHeaders,
            new DisconnectingInputStream(
                deliveredStream,
                connection,
                responseContentLength,
                virtualRangePrefixLength
            )
        );
    }

    static final class ByteLimitInputStream extends FilterInputStream {
        private final long maximum;
        private long read;

        ByteLimitInputStream(InputStream stream, long maximum) {
            super(stream);
            this.maximum = maximum;
        }

        @Override
        public int read() throws IOException {
            int value = super.read();
            if (value != -1) record(1);
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            int value = super.read(buffer, offset, length);
            if (value > 0) record(value);
            return value;
        }

        private void record(long count) throws IOException {
            read += count;
            if (read > maximum) throw new IOException("Resource stream exceeded Home's byte limit.");
        }
    }

    private WebResourceResponse payloadTooLargeResponse() {
        byte[] body = "Core response exceeded Home's 512 KiB transaction limit."
            .getBytes(StandardCharsets.UTF_8);
        Map<String, String> headers = new HashMap<>();

        headers.put("Cache-Control", "no-store");

        return new WebResourceResponse(
            "text/plain",
            StandardCharsets.UTF_8.name(),
            413,
            "Payload Too Large",
            headers,
            new ByteArrayInputStream(body)
        );
    }

    /**
     * WebView consumes a WebResourceResponse after shouldInterceptRequest returns,
     * so a non-HTML response must keep its HttpURLConnection alive. Android's
     * loader applies the browser's Range header by seeking the supplied stream,
     * even though Core already returned that range. The virtual prefix lets the
     * seek consume Core's Content-Range offset without discarding the real body.
     * WebView can also probe after EOF, so it owns the close that releases the
     * socket when consumption finishes or the request is abandoned.
     */
    static final class DisconnectingInputStream extends FilterInputStream {
        private final HttpURLConnection connection;
        private final long expectedLength;
        private boolean closed;
        private boolean endOfStream;
        private long bytesRead;
        private long virtualPrefixRemaining;

        DisconnectingInputStream(
            InputStream stream,
            HttpURLConnection connection,
            long expectedLength,
            long virtualPrefixLength
        ) {
            super(stream);
            this.connection = connection;
            this.expectedLength = expectedLength;
            this.virtualPrefixRemaining = virtualPrefixLength;
        }

        @Override
        public int read() throws IOException {
            if (endOfStream) {
                return -1;
            }

            int value = super.read();

            if (value == -1) {
                endOfStream = true;
            } else {
                recordBytesRead(1);
            }

            return value;
        }

        @Override
        public int read(byte[] buffer) throws IOException {
            return read(buffer, 0, buffer.length);
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (length == 0) {
                return 0;
            }

            if (endOfStream) {
                return -1;
            }

            int read = super.read(buffer, offset, length);

            if (read == -1) {
                endOfStream = true;
            } else {
                recordBytesRead(read);
            }

            return read;
        }

        private void recordBytesRead(long read) {
            bytesRead += read;

            // HttpURLConnection's fixed-length response stream closes itself as
            // soon as the declared final byte is consumed. Chromium can call
            // available() before attempting another read(), so latch completion
            // from Content-Length instead of touching an already-closed upstream.
            if (expectedLength >= 0 && bytesRead >= expectedLength) {
                endOfStream = true;
            }
        }

        @Override
        public int available() throws IOException {
            if (endOfStream) {
                return 0;
            }

            if (expectedLength >= 0) {
                return (int) Math.min(
                    Integer.MAX_VALUE,
                    virtualPrefixRemaining + Math.max(0, expectedLength - bytesRead)
                );
            }

            return (int) Math.min(Integer.MAX_VALUE, virtualPrefixRemaining + super.available());
        }

        @Override
        public long skip(long count) throws IOException {
            if (endOfStream || count <= 0) {
                return 0;
            }

            long virtualSkipped = Math.min(count, virtualPrefixRemaining);

            virtualPrefixRemaining -= virtualSkipped;

            if (virtualSkipped == count) {
                return virtualSkipped;
            }

            long skipped = super.skip(count - virtualSkipped);

            if (skipped > 0) {
                recordBytesRead(skipped);
            }

            return virtualSkipped + skipped;
        }

        @Override
        public void close() throws IOException {
            if (closed) {
                return;
            }

            closed = true;

            try {
                super.close();
            } finally {
                connection.disconnect();
            }
        }
    }

    private String getRequestHeader(WebResourceRequest request, String expectedName) {
        for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
            if (expectedName.equalsIgnoreCase(header.getKey())) {
                return header.getValue() == null ? "" : header.getValue();
            }
        }

        return "";
    }

    static long getContentRangeStart(Map<String, String> headers) {
        if (headers == null) {
            return 0;
        }

        for (Map.Entry<String, String> header : headers.entrySet()) {
            if (!"Content-Range".equalsIgnoreCase(header.getKey()) || header.getValue() == null) {
                continue;
            }

            Matcher match = CONTENT_RANGE_PATTERN.matcher(header.getValue().trim());

            if (!match.matches()) {
                return 0;
            }

            try {
                return Long.parseLong(match.group(1));
            } catch (NumberFormatException ignored) {
                return 0;
            }
        }

        return 0;
    }

    static long getContentRangeTotal(Map<String, String> headers) {
        if (headers == null) return -1;
        for (Map.Entry<String, String> header : headers.entrySet()) {
            if (!"Content-Range".equalsIgnoreCase(header.getKey()) || header.getValue() == null) continue;
            Matcher match = CONTENT_RANGE_PATTERN.matcher(header.getValue().trim());
            if (!match.matches() || "*".equals(match.group(3))) return -1;
            try {
                return Long.parseLong(match.group(3));
            } catch (NumberFormatException ignored) {
                return Long.MAX_VALUE;
            }
        }
        return -1;
    }

    private static boolean responseContentLengthExceeds(HttpURLConnection connection, long maximum) {
        long length = connection.getContentLengthLong();
        return length > maximum;
    }

    private InputStream getResponseStream(HttpURLConnection connection, int statusCode) throws IOException {
        InputStream stream = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();

        return stream == null ? new ByteArrayInputStream(new byte[0]) : stream;
    }

    private byte[] readAllBytes(InputStream stream) throws IOException {
        try {
            return readAllBytes(stream, Integer.MAX_VALUE);
        } catch (ResponseTooLargeException impossible) {
            throw new IOException("Response exceeded the platform byte-array limit.", impossible);
        }
    }

    static byte[] readAllBytes(InputStream stream, int maxBytes) throws IOException, ResponseTooLargeException {
        if (maxBytes < 0) {
            throw new IllegalArgumentException("maxBytes must not be negative.");
        }

        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;

            while ((read = input.read(buffer)) != -1) {
                if (read > maxBytes - output.size()) {
                    throw new ResponseTooLargeException();
                }
                output.write(buffer, 0, read);
            }

            return output.toByteArray();
        }
    }

    static final class ResponseTooLargeException extends Exception {}

    private boolean isHttpScheme(String scheme) {
        return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
    }

    private boolean isQdnRenderUrl(Uri url) {
        if (!isHttpScheme(url.getScheme())) {
            return false;
        }

        List<String> pathSegments = url.getPathSegments();

        if (pathSegments.size() < 3 || !"render".equals(pathSegments.get(0))) {
            return false;
        }

        String service = pathSegments.get(1).toUpperCase(Locale.ROOT);

        return "APP".equals(service) || "WEBSITE".equals(service) || "GAME".equals(service) || "HASH".equals(service);
    }

    private boolean hasValidBridgeToken(Uri url) {
        String bridgeToken = url.getQueryParameter(QDN_BRIDGE_QUERY_PARAM);

        return bridgeToken != null && bridgeToken.matches("[A-Za-z0-9._-]{16,128}");
    }

    private Map<String, String> getResponseHeaders(HttpURLConnection connection) {
        Map<String, String> headers = new HashMap<>();

        for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
            if (header.getKey() == null || header.getValue() == null || header.getValue().isEmpty()) {
                continue;
            }

            headers.put(header.getKey(), header.getValue().get(0));
        }

        return headers;
    }

    private void removeHeader(Map<String, String> headers, String expectedName) {
        String headerName = null;

        for (String name : headers.keySet()) {
            if (expectedName.equalsIgnoreCase(name)) {
                headerName = name;
                break;
            }
        }

        if (headerName != null) {
            headers.remove(headerName);
        }
    }

    private String getReasonPhrase(int statusCode) {
        if (statusCode >= 200 && statusCode < 300) {
            return "OK";
        }

        if (statusCode >= 300 && statusCode < 400) {
            return "Redirect";
        }

        if (statusCode >= 400 && statusCode < 500) {
            return "Client Error";
        }

        if (statusCode >= 500) {
            return "Server Error";
        }

        return "Status";
    }

    private boolean isHtmlContentType(String contentType) {
        return contentType != null && contentType.toLowerCase(Locale.ROOT).contains("text/html");
    }

    private static String getMimeType(String contentType) {
        if (contentType == null || contentType.trim().isEmpty()) {
            return "text/html";
        }

        return contentType.split(";", 2)[0].trim();
    }

    private static Charset getCharset(String contentType) {
        if (contentType == null) {
            return StandardCharsets.UTF_8;
        }

        for (String part : contentType.split(";")) {
            String trimmedPart = part.trim();

            if (!trimmedPart.toLowerCase(Locale.ROOT).startsWith("charset=")) {
                continue;
            }

            try {
                return Charset.forName(trimmedPart.substring("charset=".length()).trim());
            } catch (IllegalArgumentException ignored) {
                return StandardCharsets.UTF_8;
            }
        }

        return StandardCharsets.UTF_8;
    }

    static String getResponseEncoding(String contentType) {
        if (contentType == null) {
            return null;
        }

        String mimeType = getMimeType(contentType).toLowerCase(Locale.ROOT);

        if (
            mimeType.startsWith("text/") ||
            mimeType.contains("javascript") ||
            mimeType.contains("json") ||
            mimeType.contains("xml")
        ) {
            return getCharset(contentType).name();
        }

        // WebResourceResponse's encoding describes character encoding, not
        // transport encoding. Supplying UTF-8 for audio/video/image bytes makes
        // Chromium's media loader repeatedly probe the same range without
        // accepting it.
        return null;
    }

    static String getQdnBridgeTag(String bridgeToken, boolean homeV2Bridge) {
        String qortalBridgeInstaller = homeV2Bridge
            ? "Object.defineProperty(window,'qortalRequest',{configurable:false,enumerable:true,writable:false,value:function(request){return sendHomeRequest(request,'qortalRequest');}});"
            : "";
        return "<script>" +
            "(function(){if(typeof window.qdnRequest==='function')return;" +
            "var bridgeToken='" + bridgeToken + "';" +
            "var nextRequestId=0;var pending={};" +
            "window.addEventListener('message',function(event){" +
            "var data=event.data;if(!data||data.type!=='qortium:qdn-response'||data.bridgeToken!==bridgeToken||typeof data.requestId!=='string')return;" +
            "var entry=pending[data.requestId];if(!entry)return;delete pending[data.requestId];clearTimeout(entry.timeoutId);" +
            "if(data.error){var message=data.error.message||data.error.error||'QDN app request failed.';var err=new Error(message);Object.keys(data.error).forEach(function(key){if(key!=='message'&&key!=='error'){err[key]=data.error[key];}});entry.reject(err);return;}" +
            "entry.resolve(data.result);" +
            "});" +
            // Home 2 route/account capability invalidation. The bridge token
            // binds this parent message to the currently authorized app view;
            // apps re-read SHOW_ACTIONS and GET_HOST_INFO after the event.
            "window.addEventListener('message',function(event){var data=event.data;if(!data||data.type!=='qortium:bridge-state-changed'||data.bridgeToken!==bridgeToken||!data.detail)return;window.dispatchEvent(new CustomEvent('qortiumBridgeStateChanged',{detail:data.detail}));});" +
            // Home sends this additive runtime signal whenever its display settings
            // change. Re-dispatch it as a document event so QDN apps use the same
            // API on Android and desktop isolated views.
            "window.addEventListener('message',function(event){var data=event.data;if(!data||data.type!=='qortium:home-settings-changed'||!data.detail)return;window.dispatchEvent(new CustomEvent('qortiumHomeSettingsChanged',{detail:data.detail}));});" +
            // Manager change signals contain only a monotonic revision. Apps
            // refresh through their permissioned qdnRequest read instead of
            // receiving bookmark or notification data through postMessage.
            "window.addEventListener('message',function(event){var data=event.data;if(!data||data.type!=='qortium:bookmark-manager-changed'||!data.detail||!Number.isSafeInteger(data.detail.revision)||data.detail.revision<0)return;window.dispatchEvent(new CustomEvent('qortiumBookmarkManagerChanged',{detail:{revision:data.detail.revision}}));});" +
            "window.addEventListener('message',function(event){var data=event.data;if(!data||data.type!=='qortium:notification-manager-changed'||!data.detail||!Number.isSafeInteger(data.detail.revision)||data.detail.revision<0)return;window.dispatchEvent(new CustomEvent('qortiumNotificationManagerChanged',{detail:{revision:data.detail.revision}}));});" +
            "function sendHomeRequest(request,protocol){return new Promise(function(resolve,reject){" +
            "if(!window.parent||window.parent===window){reject(new Error('QDN app bridge is unavailable.'));return;}" +
            "var requestId=String(Date.now())+'-'+String(++nextRequestId);" +
            "var action=request&&typeof request==='object'?String(request.action||'').toUpperCase():'';" +
            "var longActions={PUBLISH_MULTIPLE_QDN_RESOURCES:1,PUBLISH_QDN_RESOURCE:1,PREVIEW_QDN_PUBLISH_SOURCE:1,DELETE_QDN_RESOURCE:1,APPROVE_GROUP_JOIN_REQUEST:1,INVITE_TO_GROUP:1,JOIN_GROUP:1,LEAVE_GROUP:1,UPDATE_GROUP:1,BUY_NAME:1,CANCEL_SELL_NAME:1,REGISTER_NAME:1,SELL_NAME:1,UPDATE_NAME:1,SEND_CHAT_MESSAGE:1,CREATE_POLL:1,VOTE_ON_POLL:1,UPDATE_POLL:1,SHOW_NOTIFICATION:1,NOTIFICATION_ADD:1,GET_APP_ASSIGNMENTS:1,REQUEST_APP_ASSIGNMENT:1,BOOKMARKS_GET:1,BOOKMARKS_APPLY:1,BOOKMARKS_OPEN:1,NOTIFICATION_MANAGER_GET:1,NOTIFICATION_MANAGER_SET_MUTED:1,NOTIFICATION_MANAGER_REMOVE_RULES:1,NOTIFICATION_MANAGER_REVOKE:1,UNLOCK_SELECTED_ACCOUNT:1,GET_USER_WALLET:1,GET_WALLET_BALANCE:1,GET_USER_WALLET_INFO:1,GET_USER_WALLET_TRANSACTIONS:1,SEND_COIN:1,SET_CURRENT_FOREIGN_SERVER:1,GET_PRIVATE_DIRECT_ACTIVE_CHATS:1,GET_PRIVATE_GROUP_ACTIVE_CHATS:1,SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES:1,SEARCH_PRIVATE_GROUP_CHAT_MESSAGES:1};" +
            "var timeoutMs=longActions[action]?330000:30000;" +
            "var timeoutId=setTimeout(function(){delete pending[requestId];reject(new Error('QDN app request timed out.'));},timeoutMs);" +
            "pending[requestId]={resolve:resolve,reject:reject,timeoutId:timeoutId};" +
            "window.parent.postMessage({type:'qortium:qdn-request',bridgeToken:bridgeToken,requestId:requestId,protocol:protocol,request:request},'*');" +
            "});}" +
            "Object.defineProperty(window,'qdnRequest',{configurable:false,enumerable:true,writable:false,value:function(request){return sendHomeRequest(request,'qdnRequest');}});" +
            qortalBridgeInstaller +
            // Forward document.title changes to the host so the app controls its
            // tab label (the desktop shell gets this from page-title-updated).
            "var lastTitle=null;" +
            "function postTitle(){" +
            "var title=typeof document.title==='string'?document.title:'';" +
            "if(title===lastTitle)return;lastTitle=title;" +
            "if(window.parent&&window.parent!==window){window.parent.postMessage({type:'qortium:qdn-title',bridgeToken:bridgeToken,title:title},'*');}" +
            "}" +
            "function watchTitle(){" +
            "postTitle();" +
            "if(typeof MutationObserver!=='function'||!document.head)return;" +
            "new MutationObserver(postTitle).observe(document.head,{subtree:true,childList:true,characterData:true});" +
            "}" +
            "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',watchTitle);}else{watchTitle();}" +
            // Mirror the iframe's real browser history into Home. Chromium's
            // Navigation API supplies stable indexes (including duplicate URLs);
            // the small shadow stack keeps older Android WebViews functional.
            "var lastNavigation=null;var fallbackEntries=[window.location.href];var fallbackIndex=0;" +
            "function getNavigationSnapshot(){" +
            "if(window.navigation&&typeof window.navigation.entries==='function'&&window.navigation.currentEntry){" +
            "var nativeEntries=window.navigation.entries();return {activeIndex:window.navigation.currentEntry.index,entries:nativeEntries.map(function(entry){return {index:entry.index,url:entry.url};})};}" +
            "return {activeIndex:fallbackIndex,entries:fallbackEntries.map(function(url,index){return {index:index,url:url};})};" +
            "}" +
            "function postNavigation(){var snapshot=getNavigationSnapshot();var serialized=JSON.stringify(snapshot);if(serialized===lastNavigation)return;lastNavigation=serialized;" +
            "if(window.parent&&window.parent!==window){window.parent.postMessage({type:'qortium:qdn-navigation',bridgeToken:bridgeToken,activeIndex:snapshot.activeIndex,entries:snapshot.entries},'*');}}" +
            "var originalPushState=window.history.pushState;" +
            "window.history.pushState=function(){var result=originalPushState.apply(this,arguments);if(!window.navigation){fallbackEntries=fallbackEntries.slice(0,fallbackIndex+1);fallbackEntries.push(window.location.href);fallbackIndex+=1;}postNavigation();return result;};" +
            "var originalReplaceState=window.history.replaceState;" +
            "window.history.replaceState=function(){var result=originalReplaceState.apply(this,arguments);if(!window.navigation){fallbackEntries[fallbackIndex]=window.location.href;}postNavigation();return result;};" +
            "function pushFallbackLocation(){if(window.navigation)return;var current=window.location.href;if(fallbackEntries[fallbackIndex]===current)return;fallbackEntries=fallbackEntries.slice(0,fallbackIndex+1);fallbackEntries.push(current);fallbackIndex+=1;}" +
            "function traverseFallbackLocation(){if(window.navigation)return;var current=window.location.href;if(fallbackEntries[fallbackIndex]===current)return;var match=fallbackEntries.lastIndexOf(current,fallbackIndex-1);if(match<0){match=fallbackEntries.indexOf(current,fallbackIndex+1);}if(match>=0){fallbackIndex=match;return;}pushFallbackLocation();}" +
            "var fallbackPopstatePending=false;" +
            "window.addEventListener('popstate',function(){fallbackPopstatePending=true;traverseFallbackLocation();postNavigation();setTimeout(function(){fallbackPopstatePending=false;},0);});" +
            // Assigning location.hash creates a real history entry without
            // calling pushState. Older WebViews need this explicit signal.
            "window.addEventListener('hashchange',function(){if(!fallbackPopstatePending){pushFallbackLocation();}fallbackPopstatePending=false;postNavigation();});" +
            "if(window.navigation){window.navigation.addEventListener('currententrychange',postNavigation);}" +
            "window.addEventListener('message',function(event){var data=event.data;if(!data||data.type!=='qortium:qdn-navigation-command'||data.bridgeToken!==bridgeToken||!Number.isInteger(data.index)||data.index<0)return;" +
            "var snapshot=getNavigationSnapshot();var target=snapshot.entries.find(function(entry){return entry.index===data.index;});if(!target)return;window.history.go(data.index-snapshot.activeIndex);});" +
            "postNavigation();" +
            "})();" +
            "</script>";
    }

    // Package-visible + static (round 5, Defect C): no instance state is used,
    // and QdnBridgeWebViewClientTest exercises this directly as part of the
    // composed classifyProxyRoute -> shouldCarryBridgeToken -> injection
    // integration test.
    static String injectQdnBridge(String html, String bridgeToken, boolean homeV2Bridge) {
        String bridgeTag = getQdnBridgeTag(bridgeToken, homeV2Bridge);
        String lowerHtml = html.toLowerCase(Locale.ROOT);
        int headStart = lowerHtml.indexOf("<head");

        if (headStart >= 0) {
            int headEnd = lowerHtml.indexOf(">", headStart);

            if (headEnd >= 0) {
                return html.substring(0, headEnd + 1) + bridgeTag + html.substring(headEnd + 1);
            }
        }

        int bodyStart = lowerHtml.indexOf("<body");

        if (bodyStart >= 0) {
            return html.substring(0, bodyStart) + bridgeTag + html.substring(bodyStart);
        }

        return bridgeTag + html;
    }
}
