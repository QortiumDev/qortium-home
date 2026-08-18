package org.qortium.home;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.Test;

public class QdnRenderProxyTest {

    @Test
    public void streamMimeHintLabelsVideoAndIsNotForwardedUpstream() {
        assertEquals("video/webm", QdnRenderProxy.sanitizeResponseMimeType(" Video/WebM "));
        assertEquals(
            "theme=dark",
            QdnRenderProxy.getUpstreamEncodedQuery(
                "theme=dark&qdnHomeMime=video%2Fwebm&qdnHomeStream=00000000-0000-4000-8000-000000000001"
            )
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

    // Round 6 (owner-directed redesign): isAuthorizedAppResource is what
    // remains of round 4/5's isSameActiveAppTabResource — the coarser
    // name/identifier containment for DATA reads (RENDER-as-plain-content and
    // PUBLIC_ARBITRARY), NOT the token/injection/CSP-strip security gate
    // (that is now isExactAuthorizedRenderDocument, tested below). The
    // initialPathname exemption is GONE — there is no third parameter and no
    // exemption branch to test; the exact-URL gate makes it unnecessary (the
    // tab's own first request IS the registered URL, by construction — see
    // AppTabStage.tsx). These mirror electron/qdn-resource-identity.test.ts
    // and src/v2/shell/render-path-identity.test.ts's bypass-list tests.
    @Test
    public void authorizedAppResourceBlocksThePreviouslyPassingBypasses() {
        QdnRenderProxy.AuthorizedDocument defaultChat = authorizedDocument(parts("render", "APP", "Chat"), null);

        // Same resource: allowed.
        assertTrue(isAuthorizedAppResource(parts("render", "APP", "Chat"), null, defaultChat));
        assertTrue(isAuthorizedAppResource(parts("render", "APP", "Chat"), "", defaultChat));

        // A default (omitted) launch identifier does NOT free the first path
        // segment for in-app routing — this proxy cannot verify "evil" is
        // not a real published identifier, so it fails closed.
        assertFalse(isAuthorizedAppResource(parts("render", "APP", "Chat", "evil"), null, defaultChat));
        // The previously-passing bypass: ?identifier= override on a default launch.
        assertFalse(isAuthorizedAppResource(parts("render", "APP", "Chat"), "evil", defaultChat));
        // A literal (case-insensitive) "default" first segment is never an identifier.
        assertTrue(isAuthorizedAppResource(parts("render", "APP", "Chat", "DEFAULT", "settings"), null, defaultChat));

        QdnRenderProxy.AuthorizedDocument docsMyApp =
            authorizedDocument(parts("render", "APP", "MyApp", "docs"), null);

        assertTrue(isAuthorizedAppResource(parts("render", "APP", "MyApp", "docs"), null, docsMyApp));
        assertTrue(isAuthorizedAppResource(parts("render", "APP", "MyApp", "docs", "page-2"), null, docsMyApp));
        assertFalse(isAuthorizedAppResource(parts("render", "APP", "MyApp", "otherIdentifier"), null, docsMyApp));
        assertFalse(isAuthorizedAppResource(parts("render", "APP", "MyApp"), null, docsMyApp));
        // The previously-passing bypass: ?identifier= override on an explicit launch identifier.
        assertFalse(isAuthorizedAppResource(parts("render", "APP", "MyApp", "docs"), "evil", docsMyApp));

        // A different app name, or the SAME name under a proxy origin with no
        // registered document at all, is blocked (fail closed).
        assertFalse(isAuthorizedAppResource(parts("render", "APP", "OtherApp"), null, defaultChat));
        assertFalse(isAuthorizedAppResource(parts("render", "APP", "Chat"), null, null));

        // WEBSITE/GAME/HASH render paths carry no per-tab identity to check —
        // always left alone (matches classifyProxyPath's existing scoping).
        assertTrue(isAuthorizedAppResource(parts("render", "WEBSITE", "Anything"), null, defaultChat));
        assertTrue(isAuthorizedAppResource(parts("render", "HASH", "abc123", "evil"), null, defaultChat));

        // Non-RENDER paths (too few segments, or not APP/WEBSITE/GAME/HASH at
        // this layer) are also left alone; classifyProxyRoute only calls this
        // for a RouteKind.RENDER/PUBLIC_ARBITRARY result in the first place.
        assertTrue(isAuthorizedAppResource(parts("render", "APP"), null, defaultChat));
    }

    // Round 4, Defect C (Sol round-3 re-review): /arbitrary/APP/<name>/... must
    // be bound to the SAME authorized app resource as /render/... — otherwise
    // an authorized tab could load ANOTHER app's (or the same app's OTHER
    // identifier's) HTML document via /arbitrary. isAuthorizedAppResource's
    // segment indexing (segments[1]=service, segments[2]=name,
    // segments[3]=identifier) is identical for "render" and "arbitrary"
    // prefixes, so this proves the SAME function correctly refuses/allows
    // arbitrary-shaped paths once QdnRenderProxy.classifyProxyRoute is wired
    // to call it for PUBLIC_ARBITRARY too (see that method). Unaffected by
    // round 6 — see isAuthorizedAppResource's doc comment for why this
    // containment is a separate, still-valid concern from the exact-URL
    // token gate.
    @Test
    public void arbitraryAppRoutesAreBoundToTheAuthorizedAppResource() {
        QdnRenderProxy.AuthorizedDocument chatEvil = authorizedDocument(parts("render", "APP", "Chat", "evil"), null);

        assertFalse(
            "an authorized Chat/evil tab must not be able to load ANOTHER app's resource as an "
                + "/arbitrary \"data\" read",
            isAuthorizedAppResource(parts("arbitrary", "APP", "OtherApp", "evil.html"), null, chatEvil)
        );
        assertFalse(
            "the SAME app under a DIFFERENT identifier is refused too",
            isAuthorizedAppResource(parts("arbitrary", "APP", "Chat", "notEvil"), null, chatEvil)
        );
        assertTrue(
            "a legitimate same-resource data fetch (electron/home-v2-app-actions.ts's "
                + "buildHomeV2ResourcePath always puts the identifier at this position and the file "
                + "path in a `filepath` QUERY param, never as a further path segment) is allowed",
            isAuthorizedAppResource(parts("arbitrary", "APP", "Chat", "evil"), null, chatEvil)
        );

        QdnRenderProxy.AuthorizedDocument defaultTrust = authorizedDocument(parts("render", "APP", "Trust"), null);
        assertTrue(
            "a default-identity app's own arbitrary data read (no identifier segment at all) is allowed",
            isAuthorizedAppResource(parts("arbitrary", "APP", "Trust"), null, defaultTrust)
        );
        assertTrue(
            "non-APP arbitrary services (images/attachments/etc, e.g. "
                + "GET_QDN_RESOURCE_STREAM_URL reads) are never gated by app-tab identity",
            isAuthorizedAppResource(parts("arbitrary", "IMAGE", "SomeoneElse", "pic.png"), null, chatEvil)
        );
        assertTrue(
            "the generic /arbitrary/resources listing route (no service/name shape at all) is "
                + "unaffected",
            isAuthorizedAppResource(parts("arbitrary", "resources"), null, chatEvil)
        );
        // Round 6: proves the "data read (filepath query) under the authorized
        // resource: served, NO token, still works" prove-it vector at the
        // containment layer — a FETCH_QDN_RESOURCE-shaped /arbitrary read
        // (identifier at segments[3], filepath carried as an UNRELATED query
        // param this identity check never inspects — see
        // electron/home-v2-app-actions.ts's buildHomeV2ResourcePath) remains
        // allowed as data; the filepath value plays no part in this check.
        assertTrue(
            "a filepath-query data read under the authorized resource is unaffected by the query",
            isAuthorizedAppResource(parts("arbitrary", "APP", "Chat", "evil"), null, chatEvil)
        );
    }

    // Round 6 (owner-directed redesign, ending the round-2/4/5
    // identifier-confusion class): the actual security gate. A RENDER
    // document request is bridge-eligible if, and ONLY if, its normalized
    // (pathname, filtered query) exactly equals the registered
    // AuthorizedDocument's — see QdnRenderProxy.isExactAuthorizedRenderDocument's
    // doc comment.
    @Test
    public void exactAuthorizedRenderDocumentRequiresAByteForByteNormalizedMatch() {
        QdnRenderProxy.AuthorizedDocument authorizedTrusted =
            authorizedDocument(parts("render", "APP", "Trusted"), "theme=dark&accent=clay");

        // The authorized document itself, byte for byte: eligible.
        assertTrue(
            "the exact authorized URL is bridge-eligible",
            isExactAuthorizedRenderDocument(parts("render", "APP", "Trusted"), "theme=dark&accent=clay", authorizedTrusted)
        );

        // Round-5 blocker, now closed at the token layer too: the SAME
        // origin, a DIFFERENT identifier via PATH — no token.
        assertFalse(
            "a different identifier via PATH than what was authorized must never be bridge-eligible",
            isExactAuthorizedRenderDocument(
                parts("render", "APP", "Trusted", "evil"),
                "theme=dark&accent=clay",
                authorizedTrusted
            )
        );
        // ...via QUERY — no token.
        assertFalse(
            "a different identifier via QUERY than what was authorized must never be bridge-eligible",
            isExactAuthorizedRenderDocument(
                parts("render", "APP", "Trusted"),
                "theme=dark&accent=clay&identifier=evil",
                authorizedTrusted
            )
        );

        // Non-APP WEBSITE/GAME/HASH render: never bridge-eligible (round-5
        // case stays closed) — the pathname alone can never match an
        // APP-shaped authorized document.
        assertFalse(
            isExactAuthorizedRenderDocument(parts("render", "WEBSITE", "Trusted"), "theme=dark&accent=clay", authorizedTrusted)
        );
        assertFalse(
            isExactAuthorizedRenderDocument(parts("render", "GAME", "Trusted"), "theme=dark&accent=clay", authorizedTrusted)
        );
        assertFalse(
            isExactAuthorizedRenderDocument(parts("render", "HASH", "Trusted"), "theme=dark&accent=clay", authorizedTrusted)
        );

        // Display-param-only difference: STILL token-eligible, in either
        // direction (missing entirely, or a DIFFERENT value) — these can
        // never distinguish one app resource from another.
        assertTrue(
            "a request with NO display params at all still matches an authorized URL that has them",
            isExactAuthorizedRenderDocument(parts("render", "APP", "Trusted"), null, authorizedTrusted)
        );
        assertTrue(
            "a request with DIFFERENT display param VALUES still matches",
            isExactAuthorizedRenderDocument(
                parts("render", "APP", "Trusted"),
                "theme=light&accent=clay&lang=en&textSize=large&uiStyle=classic",
                authorizedTrusted
            )
        );

        // Extra unexpected query param: NO token (fail closed) — even though
        // this proxy cannot prove the param actually changes what Core
        // serves.
        assertFalse(
            "an unexpected extra query param not present on the authorized URL fails closed",
            isExactAuthorizedRenderDocument(
                parts("render", "APP", "Trusted"),
                "theme=dark&accent=clay&surprise=1",
                authorizedTrusted
            )
        );

        // The bridge token param itself is ignored on both sides — its value
        // is random per tab and could never appear on the registered URL
        // (which is built before the token exists).
        assertTrue(
            "the qdnHomeBridge token param itself never affects the match",
            isExactAuthorizedRenderDocument(
                parts("render", "APP", "Trusted"),
                "theme=dark&accent=clay&qdnHomeBridge=abcdef0123456789",
                authorizedTrusted
            )
        );

        // homeV2Bridge is a constant marker AppTabStage.tsx folds into the
        // authorized URL itself before registering it (see that file) —
        // deliberately NOT ignored, so it must be present and equal on BOTH
        // sides, exactly like any other ordinary param.
        QdnRenderProxy.AuthorizedDocument withMarker =
            authorizedDocument(parts("render", "APP", "Trusted"), "homeV2Bridge=1");
        assertTrue(
            isExactAuthorizedRenderDocument(parts("render", "APP", "Trusted"), "homeV2Bridge=1", withMarker)
        );
        assertFalse(
            "homeV2Bridge is compared like any other param, not ignored — a request missing it " +
                "does not match an authorized URL that has it",
            isExactAuthorizedRenderDocument(parts("render", "APP", "Trusted"), null, withMarker)
        );

        // No registered document at all: fails closed.
        assertFalse(isExactAuthorizedRenderDocument(parts("render", "APP", "Trusted"), null, null));
    }

    // Round 7 (Sol round-6 re-review, bug 1): the exact-URL query
    // canonicalizer must be injective — two different candidate queries must
    // never normalize to the same canonical string, or a candidate whose raw
    // query genuinely differs from the registered one could still pass the
    // exact-URL gate. See QdnRenderProxy.normalizeQuery's doc comment for
    // the percent-decode-into-the-delimiter-space bug this closes.
    @Test
    public void exactUrlQueryNormalizationIsInjectiveOnRawDelimiters() {
        QdnRenderProxy.AuthorizedDocument oneParamEncodedDelimiters =
            authorizedDocument(parts("render", "APP", "Trusted"), "a=1%26b%3D2");
        QdnRenderProxy.AuthorizedDocument twoRealParams =
            authorizedDocument(parts("render", "APP", "Trusted"), "a=1&b=2");

        // The bug this closes: percent-decoding a retained value into the
        // delimiter space made a single param whose VALUE contains an
        // encoded "&"/"=" normalize identically to a genuinely different
        // two-param query. Neither direction may match.
        assertFalse(
            "a=1%26b%3D2 (one param, value \"1&b=2\") must not match the two-param a=1&b=2",
            isExactAuthorizedRenderDocument(parts("render", "APP", "Trusted"), "a=1&b=2", oneParamEncodedDelimiters)
        );
        assertFalse(
            "the reverse direction must also fail: a=1&b=2 must not match a=1%26b%3D2",
            isExactAuthorizedRenderDocument(parts("render", "APP", "Trusted"), "a=1%26b%3D2", twoRealParams)
        );

        // A second (duplicated) qdnHomeBridge param must never let an
        // otherwise-mismatched URL match — dropping the ignored param must
        // not absorb or otherwise hide a genuinely different, non-ignored
        // param sitting alongside it.
        QdnRenderProxy.AuthorizedDocument themeOnly =
            authorizedDocument(parts("render", "APP", "Trusted"), "theme=dark");
        assertFalse(
            "a duplicated qdnHomeBridge param must not let an extra real param slip past unnoticed",
            isExactAuthorizedRenderDocument(
                parts("render", "APP", "Trusted"),
                "theme=dark&qdnHomeBridge=x&qdnHomeBridge=y&surprise=1",
                themeOnly
            )
        );
        // ...but with nothing else different, a duplicated ignored param
        // alone still matches (this is intended — see
        // IGNORED_DOCUMENT_QUERY_PARAMS's doc comment).
        assertTrue(
            "a duplicated qdnHomeBridge param with nothing else different still matches",
            isExactAuthorizedRenderDocument(
                parts("render", "APP", "Trusted"),
                "theme=dark&qdnHomeBridge=x&qdnHomeBridge=y",
                themeOnly
            )
        );

        // Display-param-only differences still match.
        assertTrue(
            "display-param-only differences (including entirely different values) still match",
            isExactAuthorizedRenderDocument(parts("render", "APP", "Trusted"), "theme=light&lang=en", themeOnly)
        );

        // Param order differences still match.
        QdnRenderProxy.AuthorizedDocument abOrdered =
            authorizedDocument(parts("render", "APP", "Trusted"), "a=1&b=2");
        assertTrue(
            "param order differences still match",
            isExactAuthorizedRenderDocument(parts("render", "APP", "Trusted"), "b=2&a=1", abOrdered)
        );

        // An extra unexpected param fails to match.
        assertFalse(
            "an extra unexpected param fails to match",
            isExactAuthorizedRenderDocument(parts("render", "APP", "Trusted"), "a=1&b=2&c=3", abOrdered)
        );
    }

    // Round 7 (Sol round-6 re-review, bug 2): parseAuthorizedDocument claimed
    // (in its doc comment) to reject a document URL whose own origin does
    // not match the origin being authorized, but never actually performed
    // that check — any authorizedDocumentUrl was parsed and trusted
    // unconditionally. A caller bug (or a document URL for a completely
    // different node) must fail closed: no authorized document registered
    // at all, not the wrong node's content silently accepted.
    //
    // Exercises QdnRenderProxy.buildAuthorizedDocumentIfOriginMatches — the
    // pure scheme/host/port half of parseAuthorizedDocument, split out
    // (mirroring buildAuthorizedDocument's own split from parseAuthorizedDocument)
    // so this is directly testable without android.net.Uri, unusable in this
    // plain-JVM environment (see buildAuthorizedDocument's doc comment) —
    // parseAuthorizedDocument itself is the thin Uri-typed production
    // wrapper around it.
    @Test
    public void authorizedDocumentIsRejectedWhenItsOwnOriginDoesNotMatch() {
        QdnRenderProxy.AuthorizedDocument matching = QdnRenderProxy.buildAuthorizedDocumentIfOriginMatches(
            "https://node.example:12391",
            "https",
            "node.example",
            12391,
            parts("render", "APP", "Trusted"),
            "theme=dark"
        );
        assertEquals("a matching origin still builds the document normally", "Trusted", matching.name);

        assertNull(
            "a document URL for a DIFFERENT host than the origin being authorized must be rejected",
            QdnRenderProxy.buildAuthorizedDocumentIfOriginMatches(
                "https://node.example:12391",
                "https",
                "evil.example",
                12391,
                parts("render", "APP", "Trusted"),
                "theme=dark"
            )
        );
        assertNull(
            "a document URL for a DIFFERENT port on the SAME host must be rejected",
            QdnRenderProxy.buildAuthorizedDocumentIfOriginMatches(
                "https://node.example:12391",
                "https",
                "node.example",
                9999,
                parts("render", "APP", "Trusted"),
                "theme=dark"
            )
        );
        assertNull(
            "a document URL for a DIFFERENT scheme on the SAME host/port must be rejected",
            QdnRenderProxy.buildAuthorizedDocumentIfOriginMatches(
                "http://node.example:12391",
                "https",
                "node.example",
                12391,
                parts("render", "APP", "Trusted"),
                "theme=dark"
            )
        );
        assertNull(
            "a null expectedOrigin (authorize() called with an unusable node origin) fails closed too",
            QdnRenderProxy.buildAuthorizedDocumentIfOriginMatches(
                null,
                "https",
                "node.example",
                12391,
                parts("render", "APP", "Trusted"),
                "theme=dark"
            )
        );
    }

    // Round 7 (Sol round-6 re-review, bug 2): the production Uri-typed
    // parseAuthorizedDocument wrapper still returns null for a blank/
    // unparseable authorizedDocumentUrl — this one input shape does not
    // require constructing/inspecting an android.net.Uri (the string is
    // rejected before Uri.parse is ever reached), so it stays safe to call
    // directly in this plain-JVM environment.
    @Test
    public void parseAuthorizedDocumentRejectsBlankInputWithoutTouchingUri() {
        assertNull(QdnRenderProxy.parseAuthorizedDocument("https://node.example:12391", null));
        assertNull(QdnRenderProxy.parseAuthorizedDocument("https://node.example:12391", "   "));
        assertNull(QdnRenderProxy.parseAuthorizedDocument("https://node.example:12391", ""));
    }

    // Round 6: the "qdn://APP/Trusted/default/evil launch confusion path"
    // prove-it vector — the served "evil" document is not token-eligible
    // UNLESS the shell authorized exactly it, in which case the recorded
    // principal (name/identifier, for the separate containment check) is
    // consistently "evil" too, never "default" quietly serving different
    // content. Proves buildAuthorizedDocument derives BOTH the exact-match
    // identity and the coarser name/identifier from the SAME single
    // registered URL, so they can never disagree.
    @Test
    public void launchConfusionPathIsConsistentBetweenTheExactMatchAndTheDerivedIdentity() {
        List<String> evilSegments = parts("render", "APP", "Trusted", "default", "evil");
        QdnRenderProxy.AuthorizedDocument authorizedAsDefault = authorizedDocument(parts("render", "APP", "Trusted"), null);

        assertFalse(
            "the served evil sub-path is not bridge-eligible against a Trusted/default authorization",
            isExactAuthorizedRenderDocument(evilSegments, null, authorizedAsDefault)
        );

        // If, and only if, the shell itself authorized exactly this URL
        // (a real deep link into it), it becomes both bridge-eligible AND
        // its derived identifier is honestly "evil" — never "default"
        // silently serving different content.
        QdnRenderProxy.AuthorizedDocument authorizedAsEvilSubpath = authorizedDocument(evilSegments, null);
        assertTrue(isExactAuthorizedRenderDocument(evilSegments, null, authorizedAsEvilSubpath));
        assertEquals("Trusted", authorizedAsEvilSubpath.name);
        // segments[3]="default" is a literal default segment (resolves to
        // null), so the DERIVED identifier from this exact path is null, not
        // "evil" — "evil" here is a further in-app route segment, not the
        // resource identifier position. This documents the same resolution
        // Core's RenderResource.getPathByName performs (see
        // resolveCandidateIdentifier), consistent on both the exact-match and
        // the derived-identity side because both come from the ONE parse.
        assertEquals(null, authorizedAsEvilSubpath.identifier);
    }

    // Round 6: buildAuthorizedDocument is the ONE parser both the exact-match
    // identity and the coarser name/identifier come from — a caller can no
    // longer register a name/identifier that disagrees with the URL it also
    // registers (round 4's Defect B class of bug).
    @Test
    public void buildAuthorizedDocumentDerivesNameAndIdentifierFromTheRegisteredUrlItself() {
        QdnRenderProxy.AuthorizedDocument defaultChat = authorizedDocument(parts("render", "APP", "Chat"), null);
        assertEquals("Chat", defaultChat.name);
        assertEquals(null, defaultChat.identifier);

        QdnRenderProxy.AuthorizedDocument pathIdentifier =
            authorizedDocument(parts("render", "APP", "Chat", "evil"), null);
        assertEquals("Chat", pathIdentifier.name);
        assertEquals("evil", pathIdentifier.identifier);

        QdnRenderProxy.AuthorizedDocument queryIdentifier =
            authorizedDocument(parts("render", "APP", "Chat"), "identifier=evil");
        assertEquals("Chat", queryIdentifier.name);
        assertEquals("evil", queryIdentifier.identifier);

        // Not an APP render path at all: name/identifier are both null (fails
        // closed for both isExactAuthorizedRenderDocument and
        // isAuthorizedAppResource).
        QdnRenderProxy.AuthorizedDocument notAnAppRender = authorizedDocument(parts("render", "WEBSITE", "Chat"), null);
        assertEquals(null, notAnAppRender.name);
        assertEquals(null, notAnAppRender.identifier);

        assertEquals(null, QdnRenderProxy.buildAuthorizedDocument(null, null).name);
    }

    private static QdnRenderProxy.AuthorizedDocument authorizedDocument(List<String> segments, String encodedQuery) {
        return QdnRenderProxy.buildAuthorizedDocument(segments, encodedQuery);
    }

    private static boolean isAuthorizedAppResource(
        List<String> segments,
        String queryIdentifier,
        QdnRenderProxy.AuthorizedDocument authorized
    ) {
        return QdnRenderProxy.isAuthorizedAppResource(segments, queryIdentifier, authorized);
    }

    private static boolean isExactAuthorizedRenderDocument(
        List<String> segments,
        String encodedQuery,
        QdnRenderProxy.AuthorizedDocument authorized
    ) {
        return QdnRenderProxy.isExactAuthorizedRenderDocument(segments, encodedQuery, authorized);
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

    // Round 5, Minor 2 (Sol round-4 re-review): this used to be a hand-copied,
    // hand-translated vector list (this class's (segments, queryIdentifier)
    // shape has no 1:1 textual match with render-path-identity.test.ts's URL
    // forms), which could silently drift from the TypeScript side without
    // either test going red. Both sides now read the SAME literal vectors
    // from src/shared-fixtures/qdn-render-candidate-identifier-vectors.json
    // — see render-path-identity.test.ts's twin of this test, which drives
    // the exported TypeScript resolveCandidateIdentifier from the identical
    // file — so a future edit to either rule's behavior fails on whichever
    // side no longer matches the shared fixture.
    @Test
    public void resolveCandidateIdentifierMatchesTheSharedFixtureVectors() throws IOException {
        List<String[]> vectors = loadSharedCandidateIdentifierVectors();

        assertEquals(
            "sanity check: the shared fixture is expected to have exactly 10 vectors — update "
                + "this alongside render-path-identity.test.ts's own count check if the fixture "
                + "grows or shrinks",
            10,
            vectors.size()
        );

        for (String[] vector : vectors) {
            String description = vector[0];
            String path = vector[1];
            String queryIdentifier = vector[2];
            String expected = vector[3];

            assertEquals(
                description,
                expected,
                QdnRenderProxy.resolveCandidateIdentifier(pathSegments(path), queryIdentifier)
            );
        }
    }

    private static final Pattern CANDIDATE_IDENTIFIER_VECTOR_PATTERN = Pattern.compile(
        "\\{\\s*\"description\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"\\s*,"
            + "\\s*\"path\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"\\s*,"
            + "\\s*\"queryIdentifier\"\\s*:\\s*(?:\"((?:[^\"\\\\]|\\\\.)*)\"|null)\\s*,"
            + "\\s*\"expected\"\\s*:\\s*(?:\"((?:[^\"\\\\]|\\\\.)*)\"|null)\\s*\\}",
        Pattern.DOTALL
    );

    /**
     * Deliberately NOT a general JSON parser: a narrow, hand-rolled scanner
     * tailored to the one shared fixture's known flat shape (an array of
     * objects with exactly these 4 string/null fields, no escape sequences
     * in practice), so no new JSON library dependency is needed just to read
     * it — {@code android.net.Uri} and other Android stub classes throw at
     * runtime in this plain-JVM unit test environment (no Robolectric is
     * configured), and the same is true of the {@code org.json} classes
     * bundled in the Android SDK stub, so a real JSON parser is not free
     * here the way it would be on a normal JVM classpath.
     */
    private static List<String[]> loadSharedCandidateIdentifierVectors() throws IOException {
        File fixture = locateSharedFixture(
            "src/shared-fixtures/qdn-render-candidate-identifier-vectors.json"
        );
        String json = new String(Files.readAllBytes(fixture.toPath()), StandardCharsets.UTF_8);
        Matcher matcher = CANDIDATE_IDENTIFIER_VECTOR_PATTERN.matcher(json);
        List<String[]> vectors = new ArrayList<>();

        while (matcher.find()) {
            vectors.add(new String[] {
                matcher.group(1),
                matcher.group(2),
                matcher.group(3),
                matcher.group(4),
            });
        }

        return vectors;
    }

    /**
     * Gradle's working directory for {@code :app:testDebugUnitTest} is not
     * pinned by this project's build.gradle, so this walks upward from
     * {@code user.dir} (rather than assuming repo-root or module-root) to
     * find the fixture regardless of exactly where Gradle invoked the test
     * from.
     */
    private static File locateSharedFixture(String relativePath) {
        File dir = new File(System.getProperty("user.dir"));

        for (int depth = 0; depth < 8; depth += 1) {
            File candidate = new File(dir, relativePath);

            if (candidate.isFile()) {
                return candidate;
            }

            File parent = dir.getParentFile();

            if (parent == null) {
                break;
            }

            dir = parent;
        }

        throw new IllegalStateException(
            "Could not locate the shared fixture \"" + relativePath + "\" walking up from "
                + System.getProperty("user.dir")
        );
    }

    private static List<String> pathSegments(String path) {
        List<String> segments = new ArrayList<>();

        for (String segment : path.split("/")) {
            if (!segment.isEmpty()) {
                segments.add(segment);
            }
        }

        return segments;
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
