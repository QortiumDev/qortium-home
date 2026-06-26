import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const STARTUP_PAGES_STORAGE_KEY = 'qortium-home-startup-pages';
const MAX_STARTUP_PAGES = 10;

function normalizePages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .slice(0, MAX_STARTUP_PAGES);
}

export async function loadStartupPages(): Promise<string[]> {
  const raw = Capacitor.isNativePlatform()
    ? (await Preferences.get({ key: STARTUP_PAGES_STORAGE_KEY })).value
    : window.localStorage.getItem(STARTUP_PAGES_STORAGE_KEY);

  if (!raw) return [];

  try {
    return normalizePages(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function saveStartupPages(pages: string[]): Promise<void> {
  const value = JSON.stringify(normalizePages(pages));

  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key: STARTUP_PAGES_STORAGE_KEY, value });
    return;
  }

  window.localStorage.setItem(STARTUP_PAGES_STORAGE_KEY, value);
}

export function addStartupPage(current: string[], displayUrl: string): string[] {
  const trimmed = displayUrl.trim();
  if (!trimmed || current.includes(trimmed)) return current;
  return normalizePages([...current, trimmed]);
}

export function removeStartupPage(current: string[], displayUrl: string): string[] {
  return current.filter((p) => p !== displayUrl);
}
