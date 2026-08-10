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
import java.util.HashMap;
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
