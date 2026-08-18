import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { patchLocalNotificationRestoreReceiverSource } from './patch-local-notifications-receiver.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const receiverPath = path.join(
  projectRoot,
  'node_modules',
  '@capacitor',
  'local-notifications',
  'android',
  'src',
  'main',
  'kotlin',
  'com',
  'capacitorjs',
  'plugins',
  'localnotifications',
  'LocalNotificationRestoreReceiver.kt',
);

const original = `class LocalNotificationRestoreReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val um = context.getSystemService(UserManager::class.java)
    }
}`;

const first = patchLocalNotificationRestoreReceiverSource(original);
assert.equal(first.changed, true);
assert.match(first.source, /val action = intent\.action/);
assert.match(first.source, /action != Intent\.ACTION_LOCKED_BOOT_COMPLETED/);
assert.match(first.source, /action != Intent\.ACTION_BOOT_COMPLETED/);
assert.match(first.source, /action != "android\.intent\.action\.QUICKBOOT_POWERON"/);
assert.match(first.source, /return\n\s*}/);

const second = patchLocalNotificationRestoreReceiverSource(first.source);
assert.equal(second.changed, false);
assert.equal(second.source, first.source);

assert.throws(
  () => patchLocalNotificationRestoreReceiverSource('unexpected receiver source'),
  /Unsupported @capacitor\/local-notifications receiver source/,
);
assert.throws(
  () => patchLocalNotificationRestoreReceiverSource(`${original}\n${original}`),
  /Unsupported @capacitor\/local-notifications receiver source/,
);

const installed = readFileSync(receiverPath, 'utf8');
const installedResult = patchLocalNotificationRestoreReceiverSource(installed);
assert.equal(installedResult.changed, false, 'postinstall must patch the installed receiver');

const immediateNotificationSources = [
  readFileSync(path.join(projectRoot, 'src', 'notificationWatcher.ts'), 'utf8'),
  readFileSync(path.join(projectRoot, 'src', 'platform.ts'), 'utf8'),
];
for (const source of immediateNotificationSources) {
  const scheduleCalls = source.match(/LocalNotifications\.schedule\(\{/g) ?? [];
  const nonExactNotifications = source.match(/isExactNotification:\s*false/g) ?? [];
  assert.equal(scheduleCalls.length, 1, 'expected one native notification schedule call');
  assert.equal(
    nonExactNotifications.length,
    scheduleCalls.length,
    'immediate Home notifications must not request exact-alarm permission',
  );
}

console.log('Local-notifications restore receiver patch tests passed.');
