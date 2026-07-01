import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { getSavedAccountContext } from './accountContext';

const START_PAGES_STORAGE_KEY = 'qortium-home-start-pages';
export const MAX_START_PAGES = 10;

export type StartPage = {
  accountId: string | null;
  displayUrl: string;
  title?: string;
};

export type StartPageUpdateRequest = {
  accountId?: string | null;
  displayUrl: string;
  title: string;
};

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

  const title = 'title' in value && typeof value.title === 'string' ? value.title.trim() : '';
  const accountId = 'accountId' in value ? (value as { accountId?: string | null }).accountId : null;

  return {
    accountId: getSavedAccountContext(displayUrl, accountId),
    displayUrl,
    ...(title ? { title } : {}),
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

export function addStartPage(current: StartPage[], displayUrl: string, accountId: string | null, title = ''): StartPage[] {
  const trimmed = displayUrl.trim();
  if (!trimmed || current.some((page) => page.displayUrl === trimmed) || current.length >= MAX_START_PAGES) {
    return current;
  }

  return normalizePages([
    ...current,
    {
      accountId: getSavedAccountContext(trimmed, accountId),
      displayUrl: trimmed,
      ...(title.trim() ? { title: title.trim() } : {}),
    },
  ]);
}

export function removeStartPage(current: StartPage[], displayUrl: string): StartPage[] {
  return current.filter((page) => page.displayUrl !== displayUrl);
}

export function updateStartPage(
  current: StartPage[],
  displayUrl: string,
  request: StartPageUpdateRequest,
): StartPage[] {
  const nextDisplayUrl = request.displayUrl.trim();

  if (!nextDisplayUrl || current.some((page) => page.displayUrl !== displayUrl && page.displayUrl === nextDisplayUrl)) {
    return current;
  }

  let didUpdate = false;
  const title = request.title.trim();
  const next = current.map((page) => {
    if (page.displayUrl !== displayUrl) {
      return page;
    }

    didUpdate = true;
    return {
      accountId: getSavedAccountContext(nextDisplayUrl, request.accountId),
      displayUrl: nextDisplayUrl,
      ...(title ? { title } : {}),
    };
  });

  return didUpdate ? normalizePages(next) : current;
}
