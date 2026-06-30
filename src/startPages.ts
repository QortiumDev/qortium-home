import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const START_PAGES_STORAGE_KEY = 'qortium-home-start-pages';
export const MAX_START_PAGES = 10;

function normalizePages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .slice(0, MAX_START_PAGES);
}

export async function loadStartPages(): Promise<string[]> {
  const raw = Capacitor.isNativePlatform()
    ? (await Preferences.get({ key: START_PAGES_STORAGE_KEY })).value
    : window.localStorage.getItem(START_PAGES_STORAGE_KEY);

  if (!raw) return [];

  try {
    return normalizePages(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function saveStartPages(pages: string[]): Promise<void> {
  const value = JSON.stringify(normalizePages(pages));

  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key: START_PAGES_STORAGE_KEY, value });
    return;
  }

  window.localStorage.setItem(START_PAGES_STORAGE_KEY, value);
}

export function addStartPage(current: string[], displayUrl: string): string[] {
  const trimmed = displayUrl.trim();
  if (!trimmed || current.includes(trimmed) || current.length >= MAX_START_PAGES) return current;
  return normalizePages([...current, trimmed]);
}

export function removeStartPage(current: string[], displayUrl: string): string[] {
  return current.filter((p) => p !== displayUrl);
}
