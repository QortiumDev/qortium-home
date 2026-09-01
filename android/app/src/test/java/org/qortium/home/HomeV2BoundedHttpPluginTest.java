package org.qortium.home;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import org.junit.Test;

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
