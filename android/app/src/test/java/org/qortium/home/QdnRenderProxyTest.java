package org.qortium.home;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.util.Arrays;
import java.util.List;

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
    public void proxyClassifiesPublicQdnReadsAndRejectsOtherCoreFamilies() {
        assertRoute(parts("render", "APP", "Q-Tube"), null, true, QdnRenderProxy.RouteKind.RENDER);
        assertRoute(parts("arbitrary", "resources", "search"), null, true, QdnRenderProxy.RouteKind.PUBLIC_ARBITRARY);
        assertRoute(parts("arbitrary", "DOCUMENT", "Alice", "post"), null, true, QdnRenderProxy.RouteKind.PUBLIC_ARBITRARY);
        assertRoute(parts("admin", "status"), null, true, QdnRenderProxy.RouteKind.DENIED);
        assertRoute(parts("transactions", "search"), null, true, QdnRenderProxy.RouteKind.DENIED);
        assertRoute(parts("arbitrary", "..", "admin", "status"), null, true, QdnRenderProxy.RouteKind.DENIED);
    }

    @Test
    public void homeV2OwnsTheExactCoreBridgeClient() {
        assertRoute(parts("apps", "q-apps.js"), null, true, QdnRenderProxy.RouteKind.HOME_V2_BRIDGE_CLIENT);
        assertRoute(parts("apps", "q-apps.js"), "timestamp=123", true, QdnRenderProxy.RouteKind.HOME_V2_BRIDGE_CLIENT);
        assertRoute(parts("apps", "q-apps.js", "extra"), null, true, QdnRenderProxy.RouteKind.DENIED);
        assertRoute(parts("apps", "q-apps.js"), null, false, QdnRenderProxy.RouteKind.DENIED);
    }

    @Test
    public void transactionSignatureRouteIsExactBase58AndQueryFree() {
        String signature = repeat("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz", 2).substring(0, 88);

        assertRoute(
            parts("transactions", "signature", signature),
            null,
            true,
            QdnRenderProxy.RouteKind.TRANSACTION_SIGNATURE
        );
        assertRoute(
            parts("transactions", "signature", signature.substring(0, 64)),
            null,
            true,
            QdnRenderProxy.RouteKind.TRANSACTION_SIGNATURE
        );
        assertRoute(parts("transactions", "signature", "short"), null, true, QdnRenderProxy.RouteKind.DENIED);
        assertRoute(
            parts("transactions", "signature", signature.substring(0, 63) + "0"),
            null,
            true,
            QdnRenderProxy.RouteKind.DENIED
        );
        assertRoute(
            parts("transactions", "signature", signature),
            "foo=bar",
            true,
            QdnRenderProxy.RouteKind.DENIED
        );
        assertRoute(
            parts("transactions", "signature", signature, "extra"),
            null,
            true,
            QdnRenderProxy.RouteKind.DENIED
        );
        assertRoute(
            parts("transactions", "signature", signature),
            null,
            false,
            QdnRenderProxy.RouteKind.DENIED
        );
    }

    private static void assertRoute(
        List<String> segments,
        String encodedQuery,
        boolean homeV2,
        QdnRenderProxy.RouteKind expected
    ) {
        assertEquals(expected, QdnRenderProxy.classifyProxyPath(segments, encodedQuery, homeV2));
    }

    private static List<String> parts(String... values) {
        return Arrays.asList(values);
    }

    private static String repeat(String value, int count) {
        StringBuilder output = new StringBuilder();

        for (int index = 0; index < count; index += 1) {
            output.append(value);
        }

        return output.toString();
    }
}
