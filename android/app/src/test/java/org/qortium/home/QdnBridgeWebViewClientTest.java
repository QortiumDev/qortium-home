package org.qortium.home;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import org.junit.Test;

public class QdnBridgeWebViewClientTest {

    @Test
    public void disconnectingStreamRemainsUsableAfterSingleByteEofUntilClosed() throws Exception {
        FakeHttpURLConnection connection = new FakeHttpURLConnection();
        CloseAwareInputStream upstream = new CloseAwareInputStream(new byte[] { 42 });
        QdnBridgeWebViewClient.DisconnectingInputStream stream =
            new QdnBridgeWebViewClient.DisconnectingInputStream(upstream, connection);

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
            new QdnBridgeWebViewClient.DisconnectingInputStream(upstream, connection);
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
