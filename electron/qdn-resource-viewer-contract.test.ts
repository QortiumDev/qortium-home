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

console.log('QDN resource viewer contract tests passed.');
