package org.qortium.home;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.util.Arrays;

import org.junit.Test;

public class QdnRenderProxyTest {

    @Test
    public void streamMimeHintLabelsVideoAndIsNotForwardedUpstream() {
        assertEquals("video/webm", QdnRenderProxy.sanitizeResponseMimeType(" Video/WebM "));
        assertEquals(
            "theme=dark",
            QdnRenderProxy.getUpstreamEncodedQuery("theme=dark&qdnHomeMime=video%2Fwebm")
        );
    }

    @Test
    public void activeContentMimeHintsAreRejected() {
        assertNull(QdnRenderProxy.sanitizeResponseMimeType("text/html"));
        assertNull(QdnRenderProxy.sanitizeResponseMimeType("image/svg+xml"));
    }

    @Test
    public void proxyAllowsRenderAndPublicQdnReadsOnly() {
        assertEquals(
            true,
            QdnRenderProxy.isAllowedProxyPath(Arrays.asList("render", "APP", "Q-Tube"))
        );
        assertEquals(
            true,
            QdnRenderProxy.isAllowedProxyPath(Arrays.asList("arbitrary", "resources", "search"))
        );
        assertEquals(
            true,
            QdnRenderProxy.isAllowedProxyPath(Arrays.asList("arbitrary", "DOCUMENT", "Alice", "post"))
        );
        assertEquals(
            false,
            QdnRenderProxy.isAllowedProxyPath(Arrays.asList("admin", "status"))
        );
        assertEquals(
            false,
            QdnRenderProxy.isAllowedProxyPath(Arrays.asList("transactions", "search"))
        );
        assertEquals(
            false,
            QdnRenderProxy.isAllowedProxyPath(Arrays.asList("arbitrary", "..", "admin", "status"))
        );
    }
}
