import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const START_PAGES_STORAGE_KEY = 'qortium-home-start-pages';
export const MAX_START_PAGES = 10;

export type StartPage = {
  accountId: string | null;
  displayUrl: string;
};

function normalizeAccountId(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const accountId = value.trim();
  return accountId ? accountId : null;
}

function normalizePage(value: unknown): StartPage | null {
  if (typeof value === 'string') {
    const displayUrl = value.trim();
    return displayUrl ? { accountId: null, displayUrl } : null;
  }

  if (!value || typeof value !== 'object' || !('displayUrl' in value)) {
    return null;
  }

  const displayUrl = typeof value.displayUrl === 'string' ? value.displayUrl.trim() : '';
  if (!displayUrl) return null;

  return {
    accountId: normalizeAccountId('accountId' in value ? value.accountId : null),
    displayUrl,
  };
}

function normalizePages(value: unknown): StartPage[] {
  if (!Array.isArray(value)) return [];

  const pages: StartPage[] = [];
  const seenDisplayUrls = new Set<string>();

  for (const item of value) {
    const page = normalizePage(item);

    if (!page || seenDisplayUrls.has(page.displayUrl)) {
      continue;
    }

    pages.push(page);
    seenDisplayUrls.add(page.displayUrl);

    if (pages.length >= MAX_START_PAGES) {
      break;
    }
  }

  return pages;
}

export async function loadStartPages(): Promise<StartPage[]> {
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

export async function saveStartPages(pages: StartPage[]): Promise<void> {
  const value = JSON.stringify(normalizePages(pages));

  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key: START_PAGES_STORAGE_KEY, value });
    return;
  }

  window.localStorage.setItem(START_PAGES_STORAGE_KEY, value);
}

export function addStartPage(current: StartPage[], displayUrl: string, accountId: string | null): StartPage[] {
  const trimmed = displayUrl.trim();
  if (!trimmed || current.some((page) => page.displayUrl === trimmed) || current.length >= MAX_START_PAGES) {
    return current;
  }

  return normalizePages([...current, { accountId, displayUrl: trimmed }]);
}

export function removeStartPage(current: StartPage[], displayUrl: string): StartPage[] {
  return current.filter((page) => page.displayUrl !== displayUrl);
}
