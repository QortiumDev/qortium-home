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
  'kotlin',
  'com',
  'capacitorjs',
  'plugins',
  'localnotifications',
  'LocalNotificationRestoreReceiver.kt',
);
const managerPath = path.join(
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
  'LocalNotificationManager.kt',
);

const original = `    override fun onReceive(context: Context, intent: Intent) {
        val um = context.getSystemService(UserManager::class.java)`;

const patched = `    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (
            action != Intent.ACTION_LOCKED_BOOT_COMPLETED &&
            action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON"
        ) {
            return
        }

        val um = context.getSystemService(UserManager::class.java)`;

const managerOriginal = `            context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()`;

const managerPatched = `            context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?: throw IllegalStateException("The application launch activity is unavailable.")`;

export function patchLocalNotificationRestoreReceiverSource(source) {
  const originalCount = source.split(original).length - 1;
  const patchedCount = source.split(patched).length - 1;

  if (patchedCount === 1 && originalCount === 0) {
    return { source, changed: false };
  }

  if (originalCount === 1 && patchedCount === 0) {
    return { source: source.replace(original, patched), changed: true };
  }

  throw new Error(
    'Unsupported @capacitor/local-notifications receiver source; review the security patch before installing.',
  );
}

export function patchLocalNotificationManagerSource(source) {
  const originalCount = source.split(managerOriginal).length - 1;
  const patchedCount = source.split(managerPatched).length - 1;

  if (patchedCount === 1 && originalCount === 0) {
    return { source, changed: false };
  }

  if (originalCount === 1 && patchedCount === 0) {
    return { source: source.replace(managerOriginal, managerPatched), changed: true };
  }

  throw new Error(
    'Unsupported @capacitor/local-notifications manager source; review the security patch before installing.',
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const receiverSource = readFileSync(receiverPath, 'utf8');
  const managerSource = readFileSync(managerPath, 'utf8');
  const receiverResult = patchLocalNotificationRestoreReceiverSource(receiverSource);
  const managerResult = patchLocalNotificationManagerSource(managerSource);

  if (receiverResult.changed) {
    writeFileSync(receiverPath, receiverResult.source);
    console.log('Patched Capacitor local-notification restore receiver intent validation.');
  } else {
    console.log('Capacitor local-notification restore receiver is already patched.');
  }

  if (managerResult.changed) {
    writeFileSync(managerPath, managerResult.source);
    console.log('Patched Capacitor local-notification launch intent validation.');
  } else {
    console.log('Capacitor local-notification launch intent is already patched.');
  }
}
