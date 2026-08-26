import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  getQdnResourceStreamProxyMimeType,
  getQdnResourceStreamRequest,
  getQdnResourceViewerRequest,
  isQdnStreamableService,
  QDN_RESOURCE_VIEWER_ACTIONS,
  QDN_STREAMABLE_SERVICES,
} from './qdn-resource-viewer-contract.js';
import { QDN_APP_BRIDGE_ACTIONS, QDN_PUBLIC_NODE_BRIDGE_ACTIONS } from './qdn-app-actions.js';

assert.deepEqual(
  getQdnResourceViewerRequest({
    action: 'OPEN_QDN_RESOURCE_VIEWER',
    service: ' attachment ',
    name: ' Alice ',
    identifier: ' clip ',
    filepath: ' media/example.mp4 ',
    filename: ' example.mp4 ',
    mimeType: ' video/mp4 ',
  }),
  {
    filename: 'example.mp4',
    identifier: 'clip',
    mimeType: 'video/mp4',
    name: 'Alice',
    path: 'media/example.mp4',
    service: 'ATTACHMENT',
  },
);

assert.deepEqual(
  getQdnResourceViewerRequest({
    action: 'OPEN_QDN_RESOURCE_VIEWER',
    payload: { service: 'JSON', name: 'Alice', identifier: 'profile' },
  }),
  {
    filename: null,
    identifier: 'profile',
    mimeType: null,
    name: 'Alice',
    path: null,
    service: 'JSON',
  },
);

for (const service of ['APP', 'WEBSITE', 'GAME']) {
  assert.throws(
    () => getQdnResourceViewerRequest({ action: 'OPEN_QDN_RESOURCE_VIEWER', service, name: 'Example' }),
    /OPEN_NEW_TAB or OPEN_CURRENT_TAB/,
  );
}

assert.throws(
  () => getQdnResourceViewerRequest({ action: 'OPEN_QDN_RESOURCE_VIEWER', service: 'APP_PRIVATE', name: 'Example' }),
  /Private \(encrypted\)/,
);
assert.throws(
  () => getQdnResourceViewerRequest({ action: 'OPEN_QDN_RESOURCE_VIEWER', service: 'IMAGE' }),
  /Name is required/,
);
assert.throws(
  () =>
    getQdnResourceViewerRequest({
      action: 'OPEN_QDN_RESOURCE_VIEWER',
      service: 'IMAGE',
      name: 'a'.repeat(1025),
    }),
  /name is too long/,
);

for (const service of QDN_STREAMABLE_SERVICES) {
  assert.equal(isQdnStreamableService(service), true, `${service} must support ranged delivery.`);
  assert.equal(
    getQdnResourceStreamRequest({ action: 'GET_QDN_RESOURCE_STREAM_URL', service, name: 'Example' }).service,
    service,
  );
}

for (const service of ['JSON', 'CODE', 'GIT_REPOSITORY', 'IMAGE_GALLERY']) {
  assert.equal(isQdnStreamableService(service), false);
  assert.throws(
    () => getQdnResourceStreamRequest({ action: 'GET_QDN_RESOURCE_STREAM_URL', service, name: 'Example' }),
    /only supports image, audio, video, document, file, and attachment services/,
  );
}

assert.equal(
  getQdnResourceStreamProxyMimeType(
    getQdnResourceStreamRequest({
      action: 'GET_QDN_RESOURCE_STREAM_URL',
      service: 'VIDEO',
      name: 'Example',
      mimeType: ' Video/WebM; codecs=vp8 ',
    }),
  ),
  'video/webm',
);
assert.equal(
  getQdnResourceStreamProxyMimeType(
    getQdnResourceStreamRequest({
      action: 'GET_QDN_RESOURCE_STREAM_URL',
      service: 'ATTACHMENT',
      name: 'Example',
      filename: 'clip.MP4',
    }),
  ),
  'video/mp4',
);
assert.equal(
  getQdnResourceStreamProxyMimeType(
    getQdnResourceStreamRequest({
      action: 'GET_QDN_RESOURCE_STREAM_URL',
      service: 'VIDEO',
      name: 'Example',
      mimeType: 'text/html',
    }),
  ),
  null,
);
assert.equal(
  getQdnResourceStreamProxyMimeType(
    getQdnResourceStreamRequest({
      action: 'GET_QDN_RESOURCE_STREAM_URL',
      service: 'IMAGE',
      name: 'Example',
      mimeType: 'image/svg+xml',
    }),
  ),
  null,
);

for (const action of QDN_RESOURCE_VIEWER_ACTIONS) {
  assert.equal(QDN_APP_BRIDGE_ACTIONS.filter((candidate) => candidate === action).length, 1);
  assert.equal(QDN_PUBLIC_NODE_BRIDGE_ACTIONS.filter((candidate) => candidate === action).length, 1);
}

function readRepoSource(...candidates: string[]) {
  const url = candidates.map((candidate) => new URL(candidate, import.meta.url)).find((each) => existsSync(each));
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`);
  return readFileSync(url, 'utf8');
}

const desktop = readRepoSource('../electron/qdn.ts', './qdn.ts');
const android = readRepoSource('../src/platform.ts', './platform.ts');
const preload = readRepoSource('../electron/preload.cts', './preload.cts');
const homeV2Desktop = readRepoSource('../electron/home-v2-app-bridge.ts', './home-v2-app-bridge.ts');
const homeV2DesktopStream = readRepoSource(
  '../electron/home-v2-desktop-resource-stream.ts',
  './home-v2-desktop-resource-stream.ts',
);
const electronMain = readRepoSource('../electron/main.ts', './main.ts');
const qdnViews = readRepoSource('../electron/qdn-views.ts', './qdn-views.ts');
const homeV2Preload = readRepoSource('../electron/home-v2-live-preload.cts', './home-v2-live-preload.cts');
const homeV2Android = readRepoSource('../src/home-v2-live/node-client.ts', './src/home-v2-live/node-client.ts');
const homeV2Live = readRepoSource('../src/home-v2-live/HomeV2LiveApp.tsx', './src/home-v2-live/HomeV2LiveApp.tsx');
const androidProxy = readRepoSource(
  '../android/app/src/main/java/org/qortium/home/QdnRenderProxy.java',
  '../../android/app/src/main/java/org/qortium/home/QdnRenderProxy.java',
);
const androidWebViewClient = readRepoSource(
  '../android/app/src/main/java/org/qortium/home/QdnBridgeWebViewClient.java',
  '../../android/app/src/main/java/org/qortium/home/QdnBridgeWebViewClient.java',
);

for (const [label, source] of [
  ['desktop', desktop],
  ['Android', android],
]) {
  for (const action of QDN_RESOURCE_VIEWER_ACTIONS) {
    assert(source.includes(`case '${action}':`), `${label} must dispatch ${action}.`);
  }
  assert(
    source.includes('getQdnResourceViewerRequest') && source.includes('getQdnResourceStreamRequest'),
    `${label} must use the shared resource contract.`,
  );
}

assert(preload.includes('qdn-app:open-resource-viewer'), 'Desktop preload must expose the viewer event.');
for (const source of [homeV2Desktop, homeV2Android]) {
  for (const action of ['GET_QDN_RESOURCE_STREAM_URL', 'OPEN_QDN_RESOURCE_VIEWER', 'SAVE_QDN_RESOURCE']) {
    assert(source.includes(`action === '${action}'`), `Home 2 must dispatch ${action} on both host surfaces.`);
  }
  assert(source.includes('getQdnResourceViewerRequest'), 'Home 2 resource actions must use the shared viewer validator.');
}
assert(
  homeV2Preload.includes('home-v2-app:open-resource-viewer'),
  'Home 2 desktop preload must expose the resource viewer event.',
);
assert(
  homeV2Live.includes('authorizeHomeV2AndroidResourceStream') && homeV2Live.includes('HomeV2ResourceViewer'),
  'Home 2 Android must issue ranged resource capabilities and render the unified viewer.',
);
assert(
  androidProxy.includes('STREAM_CAPABILITY_QUERY_PARAM') && androidProxy.includes('authorizeStream'),
  'Android resource streams must use exact, expiring native capabilities.',
);
assert(
  androidProxy.includes('authorizePrivateBytes') &&
    androidProxy.includes('resolvePrivateStreamBytes') &&
    androidProxy.includes('1024 * 1024'),
  'Android private attachments must use bounded byte-backed native capabilities.',
);
assert(
  homeV2DesktopStream.includes('issueHomeV2DesktopPrivateBytesStream') &&
    homeV2DesktopStream.includes('privateByteStreamResponse') &&
    homeV2DesktopStream.includes('entry.bytes.fill(0)'),
  'Desktop private attachments must use session-bound byte-backed stream capabilities and wipe released plaintext.',
);
assert(
  androidProxy.includes('hasStreamCapabilityParameter(url)') &&
    androidProxy.includes('getAuthorizedStream(url) == null ? RouteKind.DENIED : RouteKind.RENDER'),
  'An invalid or expired Android stream token must fail closed instead of falling through to ordinary proxy authorization.',
);

// H-P2 (2026-08-26 phone pass): the SHELL-hosted viewer's media element needs a
// SAME-ORIGIN stream URL — the shell document's CSP is same-origin-only, and
// WebView refuses cross-origin media loads against interceptor-only virtual
// origins outright. The shell route serves ONLY a token-authorized upstream
// render stream: fixed path, GET/HEAD, no bridge token, private-bytes tokens
// refused, and the same stream byte caps and redirect refusal as the proxy
// route (fetchUpstream derives them from isStreamCapabilityUrl, which
// recognizes the shell form).
const androidAppHost = readRepoSource(
  '../src/home-v2-live/android-app-host.ts',
  './src/home-v2-live/android-app-host.ts',
);
const androidShellHtml = readRepoSource(
  '../src/home-v2-live/android/index.html',
  './src/home-v2-live/android/index.html',
);
assert(
  androidProxy.includes('SHELL_STREAM_PATH = "/qdn-home-stream"') &&
    androidProxy.includes('static boolean isShellStreamUrl(Uri url)') &&
    androidProxy.includes('static String resolveShellStreamUpstreamUrl(Uri url)'),
  'Android must mint shell-origin stream capabilities for the shell viewer.',
);
assert(
  androidProxy.includes('stream.privateBytes != null || stream.upstreamUrl == null) return null'),
  'The shell stream route must refuse private-bytes tokens rather than grow a second serving path.',
);
assert(
  androidProxy.includes('getAuthorizedStream(url) != null || getAuthorizedShellStream(url) != null'),
  'Stream-capability semantics (redirect refusal, byte caps) must cover the shell form.',
);
assert(
  androidWebViewClient.includes('QdnRenderProxy.isShellStreamUrl(request.getUrl())') &&
    androidWebViewClient.includes('serveShellStreamRequest'),
  'The WebView client must dispatch the shell stream route before the Capacitor handler.',
);
assert(
  androidWebViewClient.includes('fetchUpstream(request, upstreamUrl, null, null, true, true)'),
  'The shell stream route must never carry a bridge token or buffered-injection path, and forces the stream + shell-hardening policy.',
);
assert(
  androidAppHost.includes('shellStream') &&
    androidAppHost.includes("capability.pathname === '/qdn-home-stream'"),
  'The Android host must validate the shell-origin capability form it asked for.',
);
assert(
  homeV2Live.includes('minted on the shell') || homeV2Live.includes('shell-origin'),
  'The viewer mint site must document that it uses the shell-origin form.',
);
assert(
  androidShellHtml.includes("media-src 'self'") && !androidShellHtml.includes("media-src 'none'"),
  "The Android shell CSP must allow same-origin media for the viewer and nothing wider.",
);

// H-P2 hardening (Sol media-pair review): the shell route must be
// audience-gated so an app's own APP_PROXY stream token cannot be replayed on
// the shell origin, must refuse a main-frame (document) navigation, must refuse
// scriptable content types, and must stamp document-safety headers — otherwise
// a token pointed at HTML could run scripts as https://localhost. The
// stream-capability policy is resolved once and passed into fetchUpstream to
// close an expiry race that could disable redirect refusal / byte caps.
assert(
  androidProxy.includes('enum StreamAudience') &&
    androidProxy.includes('stream.audience == StreamAudience.SHELL_STREAM) return null') &&
    androidProxy.includes('stream.audience != StreamAudience.SHELL_STREAM) return null'),
  'Stream tokens must be audience-gated: app-proxy tokens never serve on the shell route, and shell tokens never serve on the app proxy.',
);
const shellRouteBody = androidWebViewClient.slice(
  androidWebViewClient.indexOf('serveShellStreamRequest(WebResourceRequest request) {'),
  androidWebViewClient.indexOf('serveProxiedQdnRequest(WebResourceRequest request) {'),
);
assert(
  shellRouteBody.includes('request.isForMainFrame()') &&
    shellRouteBody.includes('return forbiddenResponse();'),
  'The shell stream route must refuse a main-frame (document) navigation.',
);
assert(
  // Allowlist (not a scriptable denylist): only real media serves, so a
  // missing/unknown Content-Type and image/svg+xml are refused too.
  androidWebViewClient.includes('isAllowedShellMediaType') &&
    androidWebViewClient.includes('shellStream && !isAllowedShellMediaType(contentType)') &&
    // A +xml subtype is scriptable XML even under audio//video/ and must be
    // rejected before the broad prefix accept.
    androidWebViewClient.includes('bare.endsWith("+xml")') &&
    androidWebViewClient.includes("\"default-src 'none'; sandbox; frame-ancestors 'none'\"") &&
    androidWebViewClient.includes('X-Content-Type-Options') &&
    androidWebViewClient.includes('nosniff'),
  'The shell stream route must serve only allowlisted media types and stamp document-safety headers.',
);
const fetchUpstreamBody = androidWebViewClient.slice(
  androidWebViewClient.indexOf('private WebResourceResponse fetchUpstream('),
  androidWebViewClient.indexOf('static final class ByteLimitInputStream'),
);
assert(
  androidWebViewClient.includes('boolean streamCapability,') &&
    androidWebViewClient.includes('boolean shellStream') &&
    // Resolved once by the caller; fetchUpstream's own body must not re-derive
    // it from the request URL (the expiry race Sol finding 2 describes).
    !fetchUpstreamBody.includes('isStreamCapabilityUrl(request.getUrl())'),
  'fetchUpstream must take the stream-capability policy as a parameter (resolved once) rather than re-deriving it.',
);
assert(
  androidWebViewClient.includes('setInstanceFollowRedirects(!streamCapability)') &&
    androidWebViewClient.includes('new ByteLimitInputStream('),
  'Android stream capabilities must refuse redirects and bound undeclared response bodies.',
);
assert(
  homeV2DesktopStream.includes("redirect: 'error'") &&
    homeV2DesktopStream.includes('authorization.targetSession !== targetSession') &&
    electronMain.includes('registerSchemesAsPrivileged') &&
    electronMain.includes('registerHomeV2DesktopResourceStreamProtocol') &&
    qdnViews.includes('registerHomeV2DesktopResourceStreamProtocol(viewSession)'),
  'Desktop stream capabilities must refuse redirects, remain session-bound, and be registered in both the Home shell and isolated app sessions.',
);

for (const service of QDN_STREAMABLE_SERVICES) {
  assert(
    androidProxy.includes(`"${service}"`),
    `Android's secure QDN proxy must allow ${service} stream URLs.`,
  );
}
assert(
  androidWebViewClient.includes('new DisconnectingInputStream('),
  'Android must stream non-HTML proxy responses instead of buffering whole media files.',
);
assert(
  androidWebViewClient.includes('request.getRequestHeaders().entrySet()'),
  'Android must forward Range and other safe request headers.',
);
assert(
  androidWebViewClient.includes('getResponseHeaders(connection)'),
  'Android must preserve Content-Range, Accept-Ranges, and content length response headers.',
);

// Home 1.x's OPEN_QDN_MEDIA_PLAYER and OPEN_QDN_DOCUMENT_VIEWER are Home 2
// aliases of OPEN_QDN_RESOURCE_VIEWER (see canonicalHomeV2AppAction in
// electron/home-v2-app-actions.ts, which enforces each alias's narrower
// service scope and then hands the request to the canonical action). What is
// pinned here is that the canonical validator understands the legacy request
// SHAPES those actions accepted, so an alias needs no parallel parser.
assert.deepEqual(
  // 1.x OPEN_QDN_MEDIA_PLAYER: service/name/identifier/path, no filename hint.
  getQdnResourceViewerRequest({
    action: 'OPEN_QDN_MEDIA_PLAYER',
    service: 'AUDIO',
    name: 'Alice',
    identifier: 'episode-1',
    path: 'audio/episode-1.mp3',
  }),
  {
    filename: null,
    identifier: 'episode-1',
    mimeType: null,
    name: 'Alice',
    path: 'audio/episode-1.mp3',
    service: 'AUDIO',
  },
);
assert.deepEqual(
  // 1.x OPEN_QDN_DOCUMENT_VIEWER additionally carried filename and mimeType,
  // and both must survive: they are what lets Home pick the right viewer for a
  // generic FILE or ATTACHMENT resource.
  getQdnResourceViewerRequest({
    action: 'OPEN_QDN_DOCUMENT_VIEWER',
    service: 'DOCUMENT',
    name: 'Alice',
    identifier: 'whitepaper',
    path: 'docs/paper.pdf',
    filename: 'paper.pdf',
    mimeType: 'application/pdf',
  }),
  {
    filename: 'paper.pdf',
    identifier: 'whitepaper',
    mimeType: 'application/pdf',
    name: 'Alice',
    path: 'docs/paper.pdf',
    service: 'DOCUMENT',
  },
);
// Fields the contract does not know are ignored, never trusted: a legacy
// request cannot smuggle an extra instruction in through an alias.
assert.deepEqual(
  getQdnResourceViewerRequest({
    action: 'OPEN_QDN_MEDIA_PLAYER',
    service: 'VIDEO',
    name: 'Alice',
    autoplay: true,
    streamUrl: 'https://example.invalid/evil.mp4',
    sourceTabId: 'home-v2:tab:someone-else',
  }),
  {
    filename: null,
    identifier: null,
    mimeType: null,
    name: 'Alice',
    path: null,
    service: 'VIDEO',
  },
);
// The legacy shapes are still bound by every canonical rule, including the
// traversal and length guards.
assert.throws(
  () =>
    getQdnResourceViewerRequest({
      action: 'OPEN_QDN_DOCUMENT_VIEWER',
      service: 'FILE',
      name: 'Alice',
      path: '../../etc/passwd',
    }),
  /cannot contain \. or \.\. segments/,
);
assert.throws(
  () =>
    getQdnResourceViewerRequest({
      action: 'OPEN_QDN_MEDIA_PLAYER',
      service: 'AUDIO',
      name: 'Alice',
      mimeType: 'a'.repeat(1025),
    }),
  /mimeType is too long/,
);

console.log('QDN resource viewer contract tests passed.');
