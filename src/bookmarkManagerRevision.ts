import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const REVISION_STORAGE_KEY = 'qortium-home-bookmark-manager-revision';

export async function loadBookmarkManagerRevision() {
  const raw = Capacitor.isNativePlatform()
    ? (await Preferences.get({ key: REVISION_STORAGE_KEY })).value
    : window.localStorage.getItem(REVISION_STORAGE_KEY);
  const value = raw ? Number(raw) : 0;
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export async function saveBookmarkManagerRevision(revision: number) {
  const value = String(revision);
  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key: REVISION_STORAGE_KEY, value });
  } else {
    window.localStorage.setItem(REVISION_STORAGE_KEY, value);
  }
}
