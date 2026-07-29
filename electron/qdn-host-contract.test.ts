import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readSource(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readBlock(source: string, marker: string) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${marker} must exist.`);
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, `${marker} must have a closing brace.`);
  return source.slice(start, end);
}

const desktopBridge = readSource('electron/qdn.ts');
const nativeBridge = readSource('src/platform.ts');
const androidManifest = readSource('android/app/src/main/AndroidManifest.xml');

const desktopHostInfoStart = desktopBridge.indexOf("case 'GET_HOST_INFO':");
assert.notEqual(desktopHostInfoStart, -1, 'Desktop must dispatch GET_HOST_INFO.');
const desktopHostInfoEnd = desktopBridge.indexOf('\n    case ', desktopHostInfoStart + 1);
assert.notEqual(desktopHostInfoEnd, -1, 'Desktop GET_HOST_INFO must end before the next action.');
const desktopHostInfo = desktopBridge.slice(desktopHostInfoStart, desktopHostInfoEnd);
assert(
  desktopHostInfo.includes("platform: 'desktop' as const"),
  'Desktop GET_HOST_INFO must report platform=desktop.',
);

const nativeHostInfo = readBlock(nativeBridge, 'export function getQortiumHomeHostInfo()');
assert(
  nativeHostInfo.includes('platform: getHostInfoPlatform()'),
  'The native/browser bridge must include the resolved host platform.',
);

const nativePlatformResolver = readBlock(nativeBridge, 'function getHostInfoPlatform()');
for (const platform of ['android', 'ios', 'desktop']) {
  assert(
    nativePlatformResolver.includes(`'${platform}'`),
    `The native/browser platform resolver must support ${platform}.`,
  );
}

assert(
  androidManifest.includes('android:windowSoftInputMode="adjustResize"'),
  'Android must resize the app viewport when the software keyboard opens.',
);

console.log('QDN host platform and Android viewport contract tests passed.');
