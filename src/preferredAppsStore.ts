import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { DEFAULT_PREFERRED_APPS, normalizePreferredApps, type PreferredApps } from './preferredApps';

const STORE_KEY = 'qortium-home-preferred-apps';

function parseStoredPreferredApps(value: string | null): PreferredApps {
  if (!value) return { ...DEFAULT_PREFERRED_APPS };
  try { return normalizePreferredApps(JSON.parse(value)); }
  catch { return { ...DEFAULT_PREFERRED_APPS }; }
}

export function getInitialPreferredApps(): PreferredApps {
  if (Capacitor.isNativePlatform()) return { ...DEFAULT_PREFERRED_APPS };
  try { return parseStoredPreferredApps(window.localStorage.getItem(STORE_KEY)); }
  catch { return { ...DEFAULT_PREFERRED_APPS }; }
}

export async function loadPreferredApps(): Promise<PreferredApps> {
  if (Capacitor.isNativePlatform()) {
    return parseStoredPreferredApps((await Preferences.get({ key: STORE_KEY })).value);
  }
  return getInitialPreferredApps();
}

export async function savePreferredApps(preferredApps: PreferredApps) {
  const value = JSON.stringify(normalizePreferredApps(preferredApps));
  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key: STORE_KEY, value });
    return;
  }
  window.localStorage.setItem(STORE_KEY, value);
}
