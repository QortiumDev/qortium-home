import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const receiverPath = path.join(
  projectRoot,
  'node_modules',
  '@capacitor',
  'local-notifications',
  'android',
  'src',
  'main',
  'java',
  'com',
  'capacitorjs',
  'plugins',
  'localnotifications',
  'LocalNotificationRestoreReceiver.java',
);

const original = `    public void onReceive(Context context, Intent intent) {
        UserManager um = context.getSystemService(UserManager.class);`;

const patched = `    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (
            !Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action) &&
            !Intent.ACTION_BOOT_COMPLETED.equals(action) &&
            !"android.intent.action.QUICKBOOT_POWERON".equals(action)
        ) {
            return;
        }

        UserManager um = context.getSystemService(UserManager.class);`;

const source = readFileSync(receiverPath, 'utf8');

if (source.includes(patched)) {
  console.log('Capacitor local-notification restore receiver is already patched.');
} else if (source.includes(original)) {
  writeFileSync(receiverPath, source.replace(original, patched));
  console.log('Patched Capacitor local-notification restore receiver intent validation.');
} else {
  throw new Error(
    'Unsupported @capacitor/local-notifications receiver source; review the security patch before installing.',
  );
}
