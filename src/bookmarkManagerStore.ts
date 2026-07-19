import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  validateBookmarkManagerSnapshot,
  type BookmarkManagerSnapshot,
} from '../electron/bookmark-manager-contract';

const BOOKMARK_MANAGER_SNAPSHOT_KEY = 'qortium-home-bookmark-manager-snapshot';

export async function loadBookmarkManagerSnapshot(): Promise<BookmarkManagerSnapshot | null> {
  const raw = Capacitor.isNativePlatform()
    ? (await Preferences.get({ key: BOOKMARK_MANAGER_SNAPSHOT_KEY })).value
    : window.localStorage.getItem(BOOKMARK_MANAGER_SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    return validateBookmarkManagerSnapshot(JSON.parse(raw));
  } catch (error) {
    console.warn('Ignoring an invalid bookmark manager snapshot.', error);
    return null;
  }
}

export async function saveBookmarkManagerSnapshot(snapshot: BookmarkManagerSnapshot) {
  const value = JSON.stringify(validateBookmarkManagerSnapshot(snapshot));
  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key: BOOKMARK_MANAGER_SNAPSHOT_KEY, value });
  } else {
    window.localStorage.setItem(BOOKMARK_MANAGER_SNAPSHOT_KEY, value);
  }
}
