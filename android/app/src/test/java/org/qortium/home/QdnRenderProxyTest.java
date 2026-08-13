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

    // Round 4 (Sol round-3 re-review): sameActiveResource used to hardcode
    // candidatePathname=null, which DISABLES the initialPathname exemption
    // for every call below (a non-null initialPathname can never .equals(null))
    // — meaning none of these assertions ever actually exercised the
    // exemption/identifier interaction the class comment claims to cover; they
    // only exercised the tail identifier-comparison branch. Real requests
    // always carry the request's own real pathname (see QdnBridgeWebViewClient
    // serveProxiedQdnRequest, which passes url.getPath()), so this derives one
    // from the segments exactly the way a real request would, making these
    // vectors PRODUCTION-shaped again.
    //
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

        assertFalse(
            "Round 4 (Sol round-3 re-review): an explicit ?identifier= query is never exempted by a "
                + "matching initial pathname — the exemption only covers the ambiguous no-query "
                + "path-segment case, never an unambiguous explicit query identifier",
            QdnRenderProxy.isSameActiveAppTabResource(
                parts("render", "APP", "Trust", "settings"),
                "/render/APP/Trust/settings",
                "evil",
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
        // The real candidate pathname for these segments (see
        // QdnBridgeWebViewClient.serveProxiedQdnRequest, which always passes
        // request.getUrl().getPath()) — never null, unlike the bug this test
        // fixes. Passing the REAL derived pathname (rather than null) means
        // any of these vectors that happen to equal an AppIdentity's
        // initialPathname now actually exercise the exemption branch, not just
        // the tail identifier comparison.
        return QdnRenderProxy.isSameActiveAppTabResource(segments, "/" + String.join("/", segments), queryIdentifier, active);
    }

    // Round 4, Defect B (Sol round-3 re-review): the exact exploit the invalid
    // null-pathname helper above was masking. An OPEN_NEW_TAB address like
    // `qdn://APP/Chat/default?identifier=evil` (node-client.ts does no
    // identity validation on it) makes AppTabStage.tsx resolve a render URL
    // whose PATH has no identifier segment at all (`/render/APP/Chat`, since
    // Home's own address parsing says the identifier is "default") but whose
    // QUERY carries `identifier=evil` straight through. The OLD code
    // registered initialPathname="/render/APP/Chat" and let that pathname
    // match short-circuit the identifier check entirely — so the tab's own
    // first (and only) request, which carries `?identifier=evil`, sailed
    // through as if it were the registered default launch. These vectors
    // pin the fix: an explicit query identifier is NEVER covered by the
    // initialPathname exemption, only the ambiguous no-query path-segment
    // case is.
    @Test
    public void openNewTabQueryIdentifierCannotSmuggleItselfPastTheInitialPathExemption() {
        QdnRenderProxy.AppIdentity registeredAsDefault =
            new QdnRenderProxy.AppIdentity("Chat", null, "/render/APP/Chat");

        // BEFORE this fix, this returned true (the exploit): a same-pathname,
        // different-query request was waved through by the exemption without
        // ever reaching the identifier comparison below.
        assertFalse(
            "?identifier=evil against a registered Chat/default initial path must be REFUSED, "
                + "even though its pathname matches the registered initial request exactly",
            QdnRenderProxy.isSameActiveAppTabResource(
                parts("render", "APP", "Chat"),
                "/render/APP/Chat",
                "evil",
                registeredAsDefault
            )
        );

        // A path-segment identifier spoof on the SAME registered pathname —
        // impossible to construct without changing the path, but the
        // equivalent path-segment attack surface is covered by
        // initialPathnameExemptsOnlyTheExactTrustedFirstRequest below
        // (".../Trust/evil" against a ".../Trust/settings" registration).

        // Once AppTabStage.tsx registers the CORRECTLY resolved launch
        // identifier (resolveLaunchIdentifier folds the query in — see
        // render-path-identity.ts), the SAME first request is consistently
        // ALLOWED, because the declared identity now honestly says "evil"
        // rather than "default" — the app really IS evil, consistently, not
        // a "default" launch quietly serving different content.
        QdnRenderProxy.AppIdentity registeredAsEvil =
            new QdnRenderProxy.AppIdentity("Chat", "evil", "/render/APP/Chat");
        assertTrue(
            "with the launch identity correctly resolved from the query up front, the tab's own "
                + "first request is consistently allowed",
            QdnRenderProxy.isSameActiveAppTabResource(
                parts("render", "APP", "Chat"),
                "/render/APP/Chat",
                "evil",
                registeredAsEvil
            )
        );

        // A LATER request from this SAME authorized tab pivoting to a
        // DIFFERENT identifier (e.g. the app's own JS issuing
        // fetch('/render/APP/Chat?identifier=somethingElse') well after
        // launch) must still be refused — the pathname match alone must never
        // stand in for the identity check, for the FIRST request or any
        // other.
        assertFalse(
            "a later same-pathname request for a DIFFERENT identifier is refused",
            QdnRenderProxy.isSameActiveAppTabResource(
                parts("render", "APP", "Chat"),
                "/render/APP/Chat",
                "somethingElse",
                registeredAsEvil
            )
        );

        // /default/evil: an explicit "default" identifier PATH segment
        // followed by a smuggled route segment does not change the resolved
        // candidate identifier (segments[3] is what resolveCandidateIdentifier
        // inspects; "default" there resolves to null) — included here as the
        // spec's literal second vector, confirming it is refused against an
        // "evil" launch identity exactly like any other mismatch.
        assertFalse(
            "/default/evil resolves to identifier=null (a literal default segment), which does not "
                + "match a registered evil launch identity",
            QdnRenderProxy.isSameActiveAppTabResource(
                parts("render", "APP", "Chat", "default", "evil"),
                "/render/APP/Chat/default/evil",
                null,
                registeredAsEvil
            )
        );

        // A matching identifier's own deeper route IS allowed.
        assertTrue(
            QdnRenderProxy.isSameActiveAppTabResource(
                parts("render", "APP", "Chat", "evil", "settings"),
                "/render/APP/Chat/evil/settings",
                null,
                registeredAsEvil
            )
        );
    }

    // Round 4, Defect C (Sol round-3 re-review): /arbitrary/APP/<name>/... must
    // be bound to the SAME active app tab identity as /render/... — otherwise
    // an authorized tab could load ANOTHER app's (or the same app's OTHER
    // identifier's) HTML document via /arbitrary, which
    // QdnBridgeWebViewClientTest's shouldCarryBridgeToken test shows would
    // previously have been armed with the live bridge token exactly like the
    // tab's own document. isSameActiveAppTabResource's segment indexing
    // (segments[1]=service, segments[2]=name, segments[3]=identifier) is
    // identical for "render" and "arbitrary" prefixes, so this proves the
    // SAME function correctly refuses/allows arbitrary-shaped paths once
    // QdnRenderProxy.classifyProxyRoute is wired to call it for
    // PUBLIC_ARBITRARY too (see that method).
    @Test
    public void arbitraryAppRoutesAreBoundToTheSameActiveTabIdentity() {
        QdnRenderProxy.AppIdentity chatEvil = new QdnRenderProxy.AppIdentity("Chat", "evil", "/render/APP/Chat");

        assertFalse(
            "an authorized Chat/evil tab must not be able to load ANOTHER app's resource as an "
                + "/arbitrary \"data\" read",
            QdnRenderProxy.isSameActiveAppTabResource(
                parts("arbitrary", "APP", "OtherApp", "evil.html"),
                "/arbitrary/APP/OtherApp/evil.html",
                null,
                chatEvil
            )
        );
        assertFalse(
            "the SAME app under a DIFFERENT identifier is refused too",
            QdnRenderProxy.isSameActiveAppTabResource(
                parts("arbitrary", "APP", "Chat", "notEvil"),
                "/arbitrary/APP/Chat/notEvil",
                null,
                chatEvil
            )
        );
        assertTrue(
            "a legitimate same-resource data fetch (electron/home-v2-app-actions.ts's "
                + "buildHomeV2ResourcePath always puts the identifier at this position and the file "
                + "path in a `filepath` QUERY param, never as a further path segment) is allowed",
            QdnRenderProxy.isSameActiveAppTabResource(
                parts("arbitrary", "APP", "Chat", "evil"),
                "/arbitrary/APP/Chat/evil",
                null,
                chatEvil
            )
        );

        QdnRenderProxy.AppIdentity defaultTrust = new QdnRenderProxy.AppIdentity("Trust", null, "/render/APP/Trust");
        assertTrue(
            "a default-identity app's own arbitrary data read (no identifier segment at all) is allowed",
            QdnRenderProxy.isSameActiveAppTabResource(
                parts("arbitrary", "APP", "Trust"),
                "/arbitrary/APP/Trust",
                null,
                defaultTrust
            )
        );
        assertTrue(
            "non-APP arbitrary services (images/attachments/etc, e.g. "
                + "GET_QDN_RESOURCE_STREAM_URL reads) are never gated by app-tab identity",
            QdnRenderProxy.isSameActiveAppTabResource(
                parts("arbitrary", "IMAGE", "SomeoneElse", "pic.png"),
                "/arbitrary/IMAGE/SomeoneElse/pic.png",
                null,
                chatEvil
            )
        );
        assertTrue(
            "the generic /arbitrary/resources listing route (no service/name shape at all) is "
                + "unaffected",
            QdnRenderProxy.isSameActiveAppTabResource(
                parts("arbitrary", "resources"),
                "/arbitrary/resources",
                null,
                chatEvil
            )
        );
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

    // Round 4 (Sol round-3 re-review): pins parity between this class's
    // resolveCandidateIdentifier and src/v2/shell/render-path-identity.ts's
    // twin (resolveCandidateIdentifier there, exercised indirectly through
    // isSameRenderResourcePath) — the SAME literal vectors, translated from
    // that file's render-path-identity.test.ts URL forms into this class's
    // (segments, queryIdentifier) shape, so a future edit to either rule
    // cannot silently drift from the other without a red test on both sides.
    @Test
    public void resolveCandidateIdentifierMatchesTheTypeScriptTwinVectors() {
        // render-path-identity.test.ts: `${ORIGIN}/render/APP/Chat` against
        // {name:'Chat', identifier:null} → same resource (candidate null).
        assertNull(QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "Chat"), null));
        // `${ORIGIN}/render/APP/Chat/settings` → candidate 'settings' (blocked
        // against a default launch — the ambiguous path-segment case).
        assertEquals("settings", QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "Chat", "settings"), null));
        // `${ORIGIN}/render/APP/Chat/evil` → candidate 'evil'.
        assertEquals("evil", QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "Chat", "evil"), null));
        // `${ORIGIN}/render/APP/Chat?identifier=evil` → candidate 'evil' (query wins).
        assertEquals("evil", QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "Chat"), "evil"));
        // `${ORIGIN}/render/APP/Chat/default/settings` → candidate null (a
        // literal "default" first segment is never an identifier).
        assertNull(QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "Chat", "default", "settings"), null));
        // `${ORIGIN}/render/APP/MyApp/docs` against {name:'MyApp',
        // identifier:'docs'} → candidate 'docs'.
        assertEquals("docs", QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "MyApp", "docs"), null));
        // `${ORIGIN}/render/APP/MyApp/docs/page-2` → candidate still 'docs'
        // (routing lives BELOW an explicit identifier; deeper segments are
        // never inspected).
        assertEquals("docs", QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "MyApp", "docs", "page-2"), null));
        // `${ORIGIN}/render/APP/MyApp/otherIdentifier` → candidate 'otherIdentifier'.
        assertEquals("otherIdentifier", QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "MyApp", "otherIdentifier"), null));
        // `${ORIGIN}/render/APP/MyApp` → candidate null (dropping the pinned identifier).
        assertNull(QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "MyApp"), null));
        // `${ORIGIN}/render/APP/MyApp/docs?identifier=evil` → candidate 'evil' (query still wins).
        assertEquals("evil", QdnRenderProxy.resolveCandidateIdentifier(parts("render", "APP", "MyApp", "docs"), "evil"));
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
