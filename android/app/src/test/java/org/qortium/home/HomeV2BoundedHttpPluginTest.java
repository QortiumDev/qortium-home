package org.qortium.home;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import org.junit.Test;

/**
 * Unit tests for the plugin's pure helpers.
 *
 * NOT COVERED, deliberately and knowingly: the watchdog thread in
 * {@code executePost} that calls {@code disconnect()} once the overall deadline
 * passes. Exercising it needs a server that accepts a connection and then stops
 * draining the request body, and this suite is plain JVM unit tests with no
 * socket fixture to build one from. What IS covered is the half that decides
 * when the deadline has passed ({@link HomeV2BoundedHttpPlugin#clampTimeout})
 * and the half that stops sending because of it
 * ({@link HomeV2BoundedHttpPlugin#writeWithDeadline}); the watchdog exists only
 * to break a write that has blocked inside a single {@code write()} call, which
 * the chunk loop cannot interrupt on its own. Accepted at the 2026-09-02
 * security review; see docs/HOME_V2_BRIDGE_COMPATIBILITY.md.
 */
public class HomeV2BoundedHttpPluginTest {
    private static final int SERVER_RESPONSE_LIMIT = 64 * 1024;

    @Test
    public void nullStreamReturnsEmptyBody() throws Exception {
        assertArrayEquals(new byte[0], HomeV2BoundedHttpPlugin.readBounded(null, SERVER_RESPONSE_LIMIT));
    }

    @Test
    public void exactLimitIsAccepted() throws Exception {
        byte[] body = new byte[SERVER_RESPONSE_LIMIT];

        assertEquals(
                SERVER_RESPONSE_LIMIT,
                HomeV2BoundedHttpPlugin.readBounded(
                                new ByteArrayInputStream(body), SERVER_RESPONSE_LIMIT)
                        .length);
    }

    @Test
    public void authenticatedSpendContextLimitIsExplicitAndBounded() throws Exception {
        assertEquals(2 * 1024 * 1024, HomeV2BoundedHttpPlugin.DEFAULT_RESPONSE_BYTES);
        assertEquals(20 * 1024 * 1024, HomeV2BoundedHttpPlugin.MAX_RESPONSE_BYTES);
        assertEquals(
                HomeV2BoundedHttpPlugin.MAX_RESPONSE_BYTES,
                HomeV2BoundedHttpPlugin.requireValidMaxBytes(
                        HomeV2BoundedHttpPlugin.MAX_RESPONSE_BYTES));
        assertThrows(
                Exception.class,
                () -> HomeV2BoundedHttpPlugin.requireValidMaxBytes(0));
        assertThrows(
                Exception.class,
                () -> HomeV2BoundedHttpPlugin.requireValidMaxBytes(
                        HomeV2BoundedHttpPlugin.MAX_RESPONSE_BYTES + 1));
    }

    @Test
    public void timeoutsAreClampedPerPhase() {
        // A caller asking for the preview upload's 180s gets it for the WHOLE
        // call, while the socket-level ceilings stay short: one quiet read
        // still has no business taking minutes.
        assertEquals(180_000, HomeV2BoundedHttpPlugin.MAX_OVERALL_TIMEOUT_MS);
        assertEquals(
                180_000,
                HomeV2BoundedHttpPlugin.clampTimeout(
                        180_000, HomeV2BoundedHttpPlugin.MAX_OVERALL_TIMEOUT_MS));
        assertEquals(
                HomeV2BoundedHttpPlugin.MAX_OVERALL_TIMEOUT_MS,
                HomeV2BoundedHttpPlugin.clampTimeout(
                        10 * 60_000, HomeV2BoundedHttpPlugin.MAX_OVERALL_TIMEOUT_MS));
        assertEquals(
                HomeV2BoundedHttpPlugin.MAX_CONNECT_TIMEOUT_MS,
                HomeV2BoundedHttpPlugin.clampTimeout(
                        180_000, HomeV2BoundedHttpPlugin.MAX_CONNECT_TIMEOUT_MS));
        assertEquals(
                HomeV2BoundedHttpPlugin.MAX_READ_TIMEOUT_MS,
                HomeV2BoundedHttpPlugin.clampTimeout(
                        180_000, HomeV2BoundedHttpPlugin.MAX_READ_TIMEOUT_MS));
        // Nonsense falls back to the ceiling rather than to "no timeout".
        assertEquals(
                HomeV2BoundedHttpPlugin.MAX_OVERALL_TIMEOUT_MS,
                HomeV2BoundedHttpPlugin.clampTimeout(
                        0, HomeV2BoundedHttpPlugin.MAX_OVERALL_TIMEOUT_MS));
        assertEquals(
                HomeV2BoundedHttpPlugin.MAX_OVERALL_TIMEOUT_MS,
                HomeV2BoundedHttpPlugin.clampTimeout(
                        -1, HomeV2BoundedHttpPlugin.MAX_OVERALL_TIMEOUT_MS));
    }

    @Test
    public void bodyWriteStopsAtTheOverallDeadline() throws Exception {
        // The gap connect/read timeouts leave: HttpURLConnection does not time
        // OutputStream.write() at all, so a slow upload had nothing ending it.
        byte[] body = new byte[HomeV2BoundedHttpPlugin.WRITE_CHUNK_BYTES * 4];
        CountingOutputStream sink = new CountingOutputStream();

        Exception error = assertThrows(
                Exception.class,
                () -> HomeV2BoundedHttpPlugin.writeWithDeadline(
                        sink, body, System.currentTimeMillis() - 1));

        assertEquals("Authenticated node request timed out.", error.getMessage());
        assertEquals(0, sink.written);
    }

    @Test
    public void bodyWriteCompletesInChunksBeforeTheDeadline() throws Exception {
        byte[] body = new byte[HomeV2BoundedHttpPlugin.WRITE_CHUNK_BYTES * 2 + 7];
        CountingOutputStream sink = new CountingOutputStream();

        HomeV2BoundedHttpPlugin.writeWithDeadline(
                sink, body, System.currentTimeMillis() + 60_000);

        assertEquals(body.length, sink.written);
        assertEquals(3, sink.writes);
        assertEquals(1, sink.flushes);
    }

    @Test
    public void authenticatedRouteIsBoundToOriginBindingAndAllowlist() throws Exception {
        String binding = "d".repeat(32);
        HomeV2BoundedHttpPlugin.assertAllowedAuthenticatedRequest(
                new URL("https://node.example/lists/followedNames"),
                "https://node.example",
                "POST",
                "application/json",
                12,
                binding,
                binding,
                "private-key");
        HomeV2BoundedHttpPlugin.assertAllowedAuthenticatedRequest(
                new URL("http://127.0.0.1:24891/arbitrary/preview/WEBSITE/upload?filename=index.html"),
                "http://127.0.0.1:24891",
                "POST",
                "text/plain",
                HomeV2BoundedHttpPlugin.MAX_REQUEST_BYTES,
                binding,
                binding,
                "private-key");

        assertThrows(
                Exception.class,
                () -> HomeV2BoundedHttpPlugin.assertAllowedAuthenticatedRequest(
                        new URL("https://other.example/lists"), "https://node.example", "GET",
                        "application/json", 0, binding, binding, "private-key"));
        assertThrows(
                Exception.class,
                () -> HomeV2BoundedHttpPlugin.assertAllowedAuthenticatedRequest(
                        new URL("https://node.example/admin/stop"), "https://node.example", "GET",
                        "application/json", 0, binding, binding, "private-key"));
        assertThrows(
                Exception.class,
                () -> HomeV2BoundedHttpPlugin.assertAllowedAuthenticatedRequest(
                        new URL("https://node.example/lists"), "https://node.example", "GET",
                        "application/json", 0, binding, "e".repeat(32), "private-key"));
        assertThrows(
                Exception.class,
                () -> HomeV2BoundedHttpPlugin.assertAllowedAuthenticatedRequest(
                        new URL("http://node.example/lists"), "http://node.example", "GET",
                        "application/json", 0, binding, binding, "private-key"));
        assertThrows(
                Exception.class,
                () -> HomeV2BoundedHttpPlugin.assertAllowedAuthenticatedRequest(
                        new URL("https://node.example/lists"), "https://node.example", "PUT",
                        "application/json", 0, binding, binding, "private-key"));
        assertThrows(
                Exception.class,
                () -> HomeV2BoundedHttpPlugin.assertAllowedAuthenticatedRequest(
                        new URL("https://node.example/lists"), "https://node.example", "POST",
                        "application/json", 2 * 1024 * 1024 + 1, binding, binding, "private-key"));
    }

    @Test
    public void foreignWalletAllowlistIsLimitedToSupportedChainsAndReads() {
        assertEquals(
                true,
                HomeV2BoundedHttpPlugin.isAllowedPathAndMethod(
                        "/crosschain/dgb/walletbalance", "POST"));
        assertEquals(
                false,
                HomeV2BoundedHttpPlugin.isAllowedPathAndMethod(
                        "/crosschain/piratechain/walletbalance", "POST"));
        assertEquals(
                false,
                HomeV2BoundedHttpPlugin.isAllowedPathAndMethod(
                        "/crosschain/bitcoin/send", "POST"));
    }

    private static final class CountingOutputStream extends OutputStream {
        private int written;
        private int writes;
        private int flushes;

        @Override
        public void write(int value) {
            written += 1;
            writes += 1;
        }

        @Override
        public void write(byte[] buffer, int offset, int length) {
            written += length;
            writes += 1;
        }

        @Override
        public void flush() throws IOException {
            flushes += 1;
        }
    }

    @Test
    public void chunkedBodyOverLimitIsRejected() {
        InputStream unknownLengthStream = new InputStream() {
            private int remaining = SERVER_RESPONSE_LIMIT + 1;

            @Override
            public int read() {
                if (remaining == 0) return -1;
                remaining -= 1;
                return 0;
            }

            @Override
            public int read(byte[] buffer, int offset, int length) {
                if (remaining == 0) return -1;
                buffer[offset] = 0;
                remaining -= 1;
                return 1;
            }
        };

        Exception error = assertThrows(
                Exception.class,
                () -> HomeV2BoundedHttpPlugin.readBounded(
                        unknownLengthStream, SERVER_RESPONSE_LIMIT));

        assertEquals("Node API response exceeded the requested size limit.", error.getMessage());
    }
}
