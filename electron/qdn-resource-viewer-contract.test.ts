import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
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
const app = readRepoSource('../src/App.tsx', './App.tsx');
const preload = readRepoSource('../electron/preload.cts', './preload.cts');
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

assert(app.includes('onOpenResourceViewer'), 'Home must thread the generic viewer callback into QDN app frames.');
assert(preload.includes('qdn-app:open-resource-viewer'), 'Desktop preload must expose the viewer event.');

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
