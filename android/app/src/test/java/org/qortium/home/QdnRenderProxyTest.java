package org.qortium.home;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

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

    // Fix 2 (Sol re-review #2): isSameActiveAppTabResource is the trusted-
    // layer replacement for AppTabStage.tsx's app-controlled self-report
    // backstop. These mirror electron/qdn-resource-identity.test.ts and
    // src/v2/shell/render-path-identity.test.ts's bypass-list tests exactly,
    // adapted to this class's plain (segments, path, queryIdentifier) shape.
    @Test
    public void activeAppTabIdentityBlocksThePreviouslyPassingBypasses() {
        QdnRenderProxy.AppIdentity defaultChat = new QdnRenderProxy.AppIdentity("Chat", null, "/render/APP/Chat");

        // Same resource: allowed.
        assertTrue(sameActiveResource(parts("render", "APP", "Chat"), null, defaultChat));
        assertTrue(sameActiveResource(parts("render", "APP", "Chat"), "", defaultChat));

        // A default (omitted) launch identifier does NOT free the first path
        // segment for in-app routing — this proxy cannot verify "evil" is
        // not a real published identifier, so it fails closed.
        assertFalse(sameActiveResource(parts("render", "APP", "Chat", "evil"), null, defaultChat));
        // The previously-passing bypass: ?identifier= override on a default launch.
        assertFalse(sameActiveResource(parts("render", "APP", "Chat"), "evil", defaultChat));
        // A literal (case-insensitive) "default" first segment is never an identifier.
        assertTrue(sameActiveResource(parts("render", "APP", "Chat", "DEFAULT", "settings"), null, defaultChat));

        QdnRenderProxy.AppIdentity docsMyApp = new QdnRenderProxy.AppIdentity("MyApp", "docs", "/render/APP/MyApp/docs");

        assertTrue(sameActiveResource(parts("render", "APP", "MyApp", "docs"), null, docsMyApp));
        assertTrue(sameActiveResource(parts("render", "APP", "MyApp", "docs", "page-2"), null, docsMyApp));
        assertFalse(sameActiveResource(parts("render", "APP", "MyApp", "otherIdentifier"), null, docsMyApp));
        assertFalse(sameActiveResource(parts("render", "APP", "MyApp"), null, docsMyApp));
        // The previously-passing bypass: ?identifier= override on an explicit launch identifier.
        assertFalse(sameActiveResource(parts("render", "APP", "MyApp", "docs"), "evil", docsMyApp));

        // A different app name, or the SAME name under a proxy origin with no
        // registered identity at all, is blocked (fail closed).
        assertFalse(sameActiveResource(parts("render", "APP", "OtherApp"), null, defaultChat));
        assertFalse(sameActiveResource(parts("render", "APP", "Chat"), null, null));

        // WEBSITE/GAME/HASH render paths carry no per-tab identity to check —
        // always left alone (matches classifyProxyPath's existing scoping).
        assertTrue(sameActiveResource(parts("render", "WEBSITE", "Anything"), null, defaultChat));
        assertTrue(sameActiveResource(parts("render", "HASH", "abc123", "evil"), null, defaultChat));

        // Non-RENDER paths (too few segments, or not APP/WEBSITE/GAME/HASH at
        // this layer) are also left alone; classifyProxyRoute only calls this
        // for a RouteKind.RENDER result in the first place.
        assertTrue(sameActiveResource(parts("render", "APP"), null, defaultChat));
    }

    // Fix 2 follow-up: a legitimate OPEN_NEW_TAB deep link into a DEFAULT-
    // identity app's specific sub-page (e.g. qdn://APP/Trust/default/settings)
    // produces a first render request whose first path segment ("settings")
    // is otherwise indistinguishable from a spoofed identifier. The tab's own
    // registered initialPathname must be allowed regardless, but that
    // exception must NOT extend to any OTHER path — only the exact
    // registered one.
    @Test
    public void initialPathnameExemptsOnlyTheExactTrustedFirstRequest() {
        QdnRenderProxy.AppIdentity deepLinkedTrust =
            new QdnRenderProxy.AppIdentity("Trust", null, "/render/APP/Trust/settings");

        assertTrue(
            "the tab's own trusted initial deep-linked path must be allowed even though its " +
                "first segment looks like a spoofed identifier",
            QdnRenderProxy.isSameActiveAppTabResource(
                parts("render", "APP", "Trust", "settings"),
                "/render/APP/Trust/settings",
                null,
                deepLinkedTrust
            )
        );
        assertFalse(
            "a DIFFERENT path must still go through the normal identity check, even though the " +
                "tab has an initialPathname exception registered",
            QdnRenderProxy.isSameActiveAppTabResource(
                parts("render", "APP", "Trust", "evil"),
                "/render/APP/Trust/evil",
                null,
                deepLinkedTrust
            )
        );
        assertFalse(
            "the initial-path exception is on the PATH only, not the query/hash — mismatched " +
                "pathname is not the registered exact request",
            QdnRenderProxy.isSameActiveAppTabResource(
                parts("render", "APP", "Trust", "settings", "sub"),
                "/render/APP/Trust/settings/sub",
                null,
                deepLinkedTrust
            )
        );

        QdnRenderProxy.AppIdentity noDeepLink = new QdnRenderProxy.AppIdentity("Chat", null, null);

        assertFalse(
            "with no initialPathname registered, the normal identity check applies to everything",
            QdnRenderProxy.isSameActiveAppTabResource(
                parts("render", "APP", "Chat", "settings"),
                "/render/APP/Chat/settings",
                null,
                noDeepLink
            )
        );
    }

    private static boolean sameActiveResource(List<String> segments, String queryIdentifier, QdnRenderProxy.AppIdentity active) {
        return QdnRenderProxy.isSameActiveAppTabResource(segments, null, queryIdentifier, active);
    }

    @Test
    public void resolveCandidateIdentifierPrefersQueryOverPathSegment() {
        assertNull(QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "Chat"), null));
        assertNull(QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "Chat"), "  "));
        assertEquals("evil", QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "Chat"), "evil"));
        assertEquals(
            "evil",
            QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "Chat", "docs"), "evil")
        );
        assertEquals(
            "docs",
            QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "Chat", "docs"), null)
        );
        assertNull(QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "Chat", "default"), null));
        assertNull(QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "Chat", "DEFAULT"), null));
        assertNull(QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "Chat"), null));
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
