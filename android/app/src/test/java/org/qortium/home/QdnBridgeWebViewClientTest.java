package org.qortium.home;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;

public class QdnBridgeWebViewClientTest {

    @Test
    public void homeV2BridgeAddsSeparateQortalRequestWithoutChangingProductionBridge() {
        String production = QdnBridgeWebViewClient.getQdnBridgeTag("abcdefghijklmnop", false);
        String homeV2 = QdnBridgeWebViewClient.getQdnBridgeTag("abcdefghijklmnop", true);

        assertTrue(production.contains("window,'qdnRequest'"));
        assertFalse(production.contains("window,'qortalRequest'"));
        assertTrue(homeV2.contains("window,'qdnRequest'"));
        assertTrue(homeV2.contains("window,'qortalRequest'"));
        assertTrue(homeV2.contains("protocol:protocol"));
        assertTrue(homeV2.contains("qortium:qdn-title"));
        assertTrue(homeV2.contains("qortium:qdn-navigation"));
        assertTrue(homeV2.contains("qortium:qdn-navigation-command"));
    }

    @Test
    public void binaryResponsesDoNotDeclareACharacterEncoding() {
        assertNull(QdnBridgeWebViewClient.getResponseEncoding(null));
        assertNull(QdnBridgeWebViewClient.getResponseEncoding("video/webm"));
        assertNull(QdnBridgeWebViewClient.getResponseEncoding("audio/mpeg"));
        assertNull(QdnBridgeWebViewClient.getResponseEncoding("image/png"));
        assertEquals("UTF-8", QdnBridgeWebViewClient.getResponseEncoding("text/html; charset=UTF-8"));
    }

    @Test
    public void disconnectingStreamRemainsUsableAfterSingleByteEofUntilClosed() throws Exception {
        FakeHttpURLConnection connection = new FakeHttpURLConnection();
        CloseAwareInputStream upstream = new CloseAwareInputStream(new byte[] { 42 });
        QdnBridgeWebViewClient.DisconnectingInputStream stream =
            new QdnBridgeWebViewClient.DisconnectingInputStream(upstream, connection, 1, 0);

        assertEquals(42, stream.read());
        assertEquals(-1, stream.read());
        assertEquals(0, stream.available());
        assertEquals(-1, stream.read());
        assertFalse(upstream.closed);
        assertFalse(connection.disconnected);

        stream.close();
        stream.close();

        assertTrue(upstream.closed);
        assertTrue(connection.disconnected);
        assertEquals(1, connection.disconnectCount);
    }

    @Test
    public void disconnectingStreamRemainsUsableAfterBulkEofUntilClosed() throws Exception {
        FakeHttpURLConnection connection = new FakeHttpURLConnection();
        CloseAwareInputStream upstream = new CloseAwareInputStream(new byte[] { 1, 2 });
        QdnBridgeWebViewClient.DisconnectingInputStream stream =
            new QdnBridgeWebViewClient.DisconnectingInputStream(upstream, connection, 2, 0);
        byte[] buffer = new byte[4];

        assertEquals(2, stream.read(buffer, 0, buffer.length));
        assertEquals(-1, stream.read(buffer, 0, buffer.length));
        assertEquals(0, stream.available());
        assertEquals(-1, stream.read(buffer, 0, buffer.length));
        assertFalse(upstream.closed);
        assertFalse(connection.disconnected);

        stream.close();

        assertTrue(upstream.closed);
        assertTrue(connection.disconnected);
        assertEquals(1, connection.disconnectCount);
    }

    @Test
    public void disconnectingStreamLatchesEofWhenUpstreamAutoCloses() throws Exception {
        FakeHttpURLConnection connection = new FakeHttpURLConnection();
        AutoClosingAtEofInputStream upstream = new AutoClosingAtEofInputStream(new byte[] { 7 });
        QdnBridgeWebViewClient.DisconnectingInputStream stream =
            new QdnBridgeWebViewClient.DisconnectingInputStream(upstream, connection, -1, 0);
        byte[] buffer = new byte[4];

        assertEquals(1, stream.read(buffer, 0, buffer.length));
        assertEquals(-1, stream.read(buffer, 0, buffer.length));
        assertTrue(upstream.closed);

        // HttpURLConnection's real response stream can close itself at EOF.
        // WebView is still allowed to probe the wrapper again; it must receive
        // stable EOF rather than the upstream stream's "closed" exception.
        assertEquals(-1, stream.read());
        assertEquals(-1, stream.read(buffer, 0, buffer.length));
        assertEquals(0, stream.available());
        assertFalse(connection.disconnected);

        stream.close();

        assertTrue(connection.disconnected);
        assertEquals(1, connection.disconnectCount);
    }

    @Test
    public void disconnectingStreamLatchesDeclaredLengthBeforeUpstreamAvailableProbe() throws Exception {
        FakeHttpURLConnection connection = new FakeHttpURLConnection();
        AutoClosingOnFinalByteInputStream upstream = new AutoClosingOnFinalByteInputStream(new byte[] { 8, 9 });
        QdnBridgeWebViewClient.DisconnectingInputStream stream =
            new QdnBridgeWebViewClient.DisconnectingInputStream(upstream, connection, 2, 0);
        byte[] buffer = new byte[4];

        // WebResourceResponse explicitly consumes streams through read(byte[]).
        assertEquals(2, stream.read(buffer));
        assertTrue(upstream.closed);

        // The real fixed-length HttpURLConnection stream closes itself while
        // returning the final bytes, without first returning -1. WebView's
        // immediate available/read probes must still see a clean EOF.
        assertEquals(0, stream.available());
        assertEquals(-1, stream.read());
        assertEquals(-1, stream.read(buffer));
        assertEquals(0, stream.read(buffer, 0, 0));
        assertFalse(connection.disconnected);

        stream.close();

        assertTrue(connection.disconnected);
        assertEquals(1, connection.disconnectCount);
    }

    @Test
    public void disconnectingStreamMapsUpstreamRangeIntoWebViewSeek() throws Exception {
        FakeHttpURLConnection connection = new FakeHttpURLConnection();
        CloseAwareInputStream upstream = new CloseAwareInputStream(new byte[] { 3, 4 });
        QdnBridgeWebViewClient.DisconnectingInputStream stream =
            new QdnBridgeWebViewClient.DisconnectingInputStream(upstream, connection, 2, 2);
        byte[] buffer = new byte[4];

        assertEquals(4, stream.available());
        assertEquals(2, stream.skip(2));
        assertEquals(2, stream.available());
        assertEquals(2, stream.read(buffer));
        assertEquals(0, stream.available());
        assertEquals(-1, stream.read());
        assertFalse(connection.disconnected);

        stream.close();

        assertTrue(connection.disconnected);
    }

    @Test
    public void contentRangeStartUsesTheUpstreamPartialResponseOffset() {
        Map<String, String> headers = new HashMap<>();

        headers.put("content-range", "bytes 1867776-1898556/1898557");

        assertEquals(1867776, QdnBridgeWebViewClient.getContentRangeStart(headers));

        headers.put("content-range", "invalid");

        assertEquals(0, QdnBridgeWebViewClient.getContentRangeStart(headers));
    }

    @Test
    public void boundedTransactionResponsesAcceptTheLimitAndRejectOneByteMore() throws Exception {
        int limit = QdnBridgeWebViewClient.TRANSACTION_RESPONSE_MAX_BYTES;
        byte[] accepted = new byte[limit];

        assertEquals(
            limit,
            QdnBridgeWebViewClient.readAllBytes(new ByteArrayInputStream(accepted), limit).length
        );

        try {
            QdnBridgeWebViewClient.readAllBytes(new ByteArrayInputStream(new byte[limit + 1]), limit);
        } catch (QdnBridgeWebViewClient.ResponseTooLargeException expected) {
            return;
        }

        throw new AssertionError("A transaction response above 512 KiB was accepted.");
    }

    // Round 4, Defect C (Sol round-3 re-review): the exploit was that
    // serveProxiedQdnRequest forwarded the request's bridgeToken query param
    // to fetchUpstream REGARDLESS of route — so any HTML response reachable
    // via /arbitrary (an app's own, or, before QdnRenderProxy's identity check
    // was extended to PUBLIC_ARBITRARY, another resource's) got the live
    // qdnRequest/qortalRequest signing bridge injected into it exactly as if
    // it were this tab's own authorized document. Before this fix,
    // shouldCarryBridgeToken did not exist and the token flowed for every
    // route; after, it flows ONLY for RENDER.
    @Test
    public void bridgeTokenOnlyCarriesForRenderRoutes() {
        assertTrue(
            "the tab's own authorized top-level APP render document may carry the bridge token",
            QdnBridgeWebViewClient.shouldCarryBridgeToken(QdnRenderProxy.RouteKind.RENDER, true, appSegments())
        );
        assertTrue(
            "a v1 (non-homeV2) origin has no per-tab identity to protect, so any RENDER "
                + "service keeps carrying the token exactly as it always has",
            QdnBridgeWebViewClient.shouldCarryBridgeToken(QdnRenderProxy.RouteKind.RENDER, false, websiteSegments())
        );
        assertFalse(
            "Round 5, Defect C: a homeV2 origin's non-APP RENDER service (WEBSITE here) must "
                + "never carry the bridge token, even though the route itself remains servable "
                + "as plain data",
            QdnBridgeWebViewClient.shouldCarryBridgeToken(QdnRenderProxy.RouteKind.RENDER, true, websiteSegments())
        );
        assertFalse(
            "same closure for GAME",
            QdnBridgeWebViewClient.shouldCarryBridgeToken(QdnRenderProxy.RouteKind.RENDER, true, gameSegments())
        );
        assertFalse(
            "same closure for HASH",
            QdnBridgeWebViewClient.shouldCarryBridgeToken(QdnRenderProxy.RouteKind.RENDER, true, hashSegments())
        );
        assertFalse(
            "a /arbitrary DATA read must never carry the live signing/account-read bridge token, "
                + "even for the tab's own resource, or its response could be armed as a "
                + "bridge-connected document",
            QdnBridgeWebViewClient.shouldCarryBridgeToken(
                QdnRenderProxy.RouteKind.PUBLIC_ARBITRARY,
                true,
                appSegments()
            )
        );
        assertFalse(
            QdnBridgeWebViewClient.shouldCarryBridgeToken(
                QdnRenderProxy.RouteKind.TRANSACTION_SIGNATURE,
                true,
                appSegments()
            )
        );
        assertFalse(
            QdnBridgeWebViewClient.shouldCarryBridgeToken(
                QdnRenderProxy.RouteKind.HOME_V2_BRIDGE_CLIENT,
                true,
                appSegments()
            )
        );
        assertFalse(
            QdnBridgeWebViewClient.shouldCarryBridgeToken(QdnRenderProxy.RouteKind.DENIED, true, appSegments())
        );
    }

    // Round 5, Defect C (Sol round-4 re-review): the FULL composition Sol's
    // review said the unit tests never exercised — classifyProxyPath (the
    // pure twin classifyProxyRoute delegates to) -> isSameActiveAppTabResource
    // (the identity check classifyProxyRoute applies for RENDER/
    // PUBLIC_ARBITRARY on a homeV2 origin) -> shouldCarryBridgeToken -> the
    // injection decision fetchUpstream makes from that token. Uri/
    // HttpURLConnection plumbing itself is not exercised (android.net.Uri is
    // unusable in this plain-JVM unit test environment — see
    // QdnRenderProxy.isBridgeEligibleRenderService's doc comment); every
    // method this composes is the exact production method the Uri-typed
    // wrappers (classifyProxyRoute, serveProxiedQdnRequest,
    // shouldOverrideUrlLoading) delegate to.
    @Test
    public void appTabNavigationToAnotherServiceNeverBecomesTheBridgedDocument() {
        QdnRenderProxy.AppIdentity chatIdentity =
            new QdnRenderProxy.AppIdentity("Chat", null, "/render/APP/Chat");
        String bridgeToken = "0123456789abcdef";
        String html = "<html><head><title>x</title></head><body>hi</body></html>";

        // The authorized APP's own render: gets the token and the working bridge.
        assertComposedDecision(
            "the authorized APP's own render still gets the token and works",
            appSegments(),
            "/render/APP/Chat",
            null,
            chatIdentity,
            true,
            bridgeToken,
            html,
            true
        );

        // Before round 5 (the vulnerable predicate this fix replaced): ANY
        // RouteKind.RENDER response carried the token, so this exact WEBSITE/
        // GAME/HASH navigation from the SAME authorized iframe (its own
        // location already carries the token in the query — no cooperation
        // from the app needed to bring it along) was armed with the live
        // bridge and a stripped CSP under the still-authorized Chat identity.
        boolean vulnerablePredicate = QdnRenderProxy.RouteKind.RENDER
            == classify(websiteSegments(), null, true, chatIdentity, "/render/WEBSITE/attacker/index.html");
        assertTrue(
            "documents the closed vulnerability: the route alone (ignoring service) was RENDER, "
                + "so the OLD one-argument shouldCarryBridgeToken(route) would have returned true here",
            vulnerablePredicate
        );

        // After round 5: an APP-tab navigation to WEBSITE/GAME/HASH on the same
        // shared origin yields NO bridge token and is not served as the app's
        // bridged document, even though the route itself remains RENDER (servable
        // as plain, non-bridged data — see isBridgeEligibleRenderService).
        assertComposedDecision(
            "APP-tab navigation to /render/WEBSITE/<other>/... yields NO bridge token",
            websiteSegments(),
            "/render/WEBSITE/attacker/index.html",
            null,
            chatIdentity,
            true,
            bridgeToken,
            html,
            false
        );
        assertComposedDecision(
            "same closure for GAME",
            gameSegments(),
            "/render/GAME/attacker/index.html",
            null,
            chatIdentity,
            true,
            bridgeToken,
            html,
            false
        );
        assertComposedDecision(
            "same closure for HASH",
            hashSegments(),
            "/render/HASH/attacker/index.html",
            null,
            chatIdentity,
            true,
            bridgeToken,
            html,
            false
        );

        // A comment-suppressed-reporter HTML document cannot obtain a bridge
        // principal: even though this attacker page's raw HTML is crafted to
        // defeat injectQdnBridge's naive "<head" locator (a decoy comment
        // lands any injected script inside an HTML comment, where it never
        // executes and the self-report never fires), the composed decision
        // never reaches injection at all for this route/service — there is no
        // bridge principal to obtain regardless of the comment trick.
        String commentSuppressedHtml =
            "<!-- fake <head> marker --><html><head><title>x</title></head><body>hi</body></html>";
        QdnRenderProxy.RouteKind websiteRoute =
            classify(websiteSegments(), null, true, chatIdentity, "/render/WEBSITE/attacker/index.html");
        boolean websiteCarriesToken = QdnBridgeWebViewClient.shouldCarryBridgeToken(
            websiteRoute,
            true,
            websiteSegments()
        );
        assertFalse("the comment-suppressed attacker page never becomes bridge-eligible", websiteCarriesToken);
        // Documents WHY the comment trick would have mattered under the old,
        // vulnerable predicate: injectQdnBridge's own locator lands the bridge
        // tag inside the decoy comment, so even the injected script itself
        // would never have run — the app would have had to hand-roll the raw
        // postMessage protocol instead, using the token straight off its own
        // location.href. That is exactly why the token/injection gate, not the
        // app's self-report, must be the enforcement (see shouldCarryBridgeToken's
        // doc comment).
        String wouldBeInjected = QdnBridgeWebViewClient.injectQdnBridge(commentSuppressedHtml, bridgeToken, true);
        int decoyCommentEnd = wouldBeInjected.indexOf("-->");
        int scriptStart = wouldBeInjected.indexOf("<script>");
        assertTrue(
            "the injector locator really is defeated by the decoy comment (documents the class of "
                + "bug the token gate — not the injector or the self-report — must close)",
            scriptStart >= 0 && scriptStart < decoyCommentEnd
        );
    }

    private void assertComposedDecision(
        String message,
        List<String> segments,
        String candidatePathname,
        String queryIdentifier,
        QdnRenderProxy.AppIdentity active,
        boolean homeV2,
        String bridgeToken,
        String html,
        boolean expectBridged
    ) {
        QdnRenderProxy.RouteKind route = classify(segments, queryIdentifier, homeV2, active, candidatePathname);
        boolean carriesToken = QdnBridgeWebViewClient.shouldCarryBridgeToken(route, homeV2, segments);

        assertEquals(message + " (token carriage)", expectBridged, carriesToken);

        String served = carriesToken ? QdnBridgeWebViewClient.injectQdnBridge(html, bridgeToken, true) : html;

        assertEquals(
            message + " (served document unchanged when not bridge-eligible)",
            expectBridged,
            served.contains("qdnRequest")
        );

        if (expectBridged) {
            assertTrue(message + " (qortalRequest also installed)", served.contains("qortalRequest"));
        }
    }

    // Mirrors QdnRenderProxy.classifyProxyRoute's own composition (classifyProxyPath,
    // then isSameActiveAppTabResource for RENDER/PUBLIC_ARBITRARY on a homeV2 origin)
    // using the pure static twins directly, since android.net.Uri cannot be
    // constructed in this plain-JVM unit test environment.
    private static QdnRenderProxy.RouteKind classify(
        List<String> segments,
        String queryIdentifier,
        boolean homeV2,
        QdnRenderProxy.AppIdentity active,
        String candidatePathname
    ) {
        QdnRenderProxy.RouteKind route = QdnRenderProxy.classifyProxyPath(segments, null, homeV2);

        if (
            (route == QdnRenderProxy.RouteKind.RENDER || route == QdnRenderProxy.RouteKind.PUBLIC_ARBITRARY)
                && homeV2
                && !QdnRenderProxy.isSameActiveAppTabResource(segments, candidatePathname, queryIdentifier, active)
        ) {
            return QdnRenderProxy.RouteKind.DENIED;
        }

        return route;
    }

    private static List<String> appSegments() {
        return Arrays.asList("render", "APP", "Chat");
    }

    private static List<String> websiteSegments() {
        return Arrays.asList("render", "WEBSITE", "attacker", "index.html");
    }

    private static List<String> gameSegments() {
        return Arrays.asList("render", "GAME", "attacker", "index.html");
    }

    private static List<String> hashSegments() {
        return Arrays.asList("render", "HASH", "attacker", "index.html");
    }

    @Test
    public void proxyCompatibilityReadsRemainGetOnly() {
        assertTrue(QdnBridgeWebViewClient.isAllowedProxyMethod("GET"));
        assertTrue(QdnBridgeWebViewClient.isAllowedProxyMethod("get"));
        assertFalse(QdnBridgeWebViewClient.isAllowedProxyMethod("HEAD"));
        assertFalse(QdnBridgeWebViewClient.isAllowedProxyMethod("POST"));
        assertFalse(QdnBridgeWebViewClient.isAllowedProxyMethod(null));
    }

    private static final class CloseAwareInputStream extends FilterInputStream {
        private boolean closed;

        CloseAwareInputStream(byte[] bytes) {
            super(new ByteArrayInputStream(bytes));
        }

        @Override
        public int read() throws IOException {
            ensureOpen();
            return super.read();
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            ensureOpen();
            return super.read(buffer, offset, length);
        }

        @Override
        public int available() throws IOException {
            ensureOpen();
            return super.available();
        }

        @Override
        public void close() throws IOException {
            closed = true;
            super.close();
        }

        private void ensureOpen() throws IOException {
            if (closed) {
                throw new IOException("closed");
            }
        }
    }

    private static final class AutoClosingAtEofInputStream extends FilterInputStream {
        private boolean closed;

        AutoClosingAtEofInputStream(byte[] bytes) {
            super(new ByteArrayInputStream(bytes));
        }

        @Override
        public int read() throws IOException {
            ensureOpen();
            int value = super.read();

            if (value == -1) {
                closed = true;
            }

            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            ensureOpen();
            int read = super.read(buffer, offset, length);

            if (read == -1) {
                closed = true;
            }

            return read;
        }

        @Override
        public int available() throws IOException {
            ensureOpen();
            return super.available();
        }

        private void ensureOpen() throws IOException {
            if (closed) {
                throw new IOException("closed");
            }
        }
    }

    private static final class AutoClosingOnFinalByteInputStream extends FilterInputStream {
        private boolean closed;
        private int remaining;

        AutoClosingOnFinalByteInputStream(byte[] bytes) {
            super(new ByteArrayInputStream(bytes));
            remaining = bytes.length;
        }

        @Override
        public int read() throws IOException {
            ensureOpen();
            int value = super.read();

            if (value != -1) {
                recordBytesRead(1);
            }

            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            ensureOpen();
            int read = super.read(buffer, offset, length);

            if (read > 0) {
                recordBytesRead(read);
            }

            return read;
        }

        @Override
        public int available() throws IOException {
            ensureOpen();
            return super.available();
        }

        private void recordBytesRead(int read) {
            remaining -= read;

            if (remaining == 0) {
                closed = true;
            }
        }

        private void ensureOpen() throws IOException {
            if (closed) {
                throw new IOException("closed");
            }
        }
    }

    private static final class FakeHttpURLConnection extends HttpURLConnection {
        private boolean disconnected;
        private int disconnectCount;

        FakeHttpURLConnection() throws IOException {
            super(new URL("https://qdn.invalid/resource"));
        }

        @Override
        public void disconnect() {
            disconnected = true;
            disconnectCount += 1;
        }

        @Override
        public boolean usingProxy() {
            return false;
        }

        @Override
        public void connect() {}
    }
}
