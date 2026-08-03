import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

export const WELCOME_STATE_STORAGE_KEY = 'qortium-home-welcome-state';

const PROFILE_FOOTPRINT_STORAGE_KEYS = [
  'qortium-home-wallet-store',
  'qortium-home-node-settings',
  'qortium-home-start-pages',
  'qortium-home-bookmarks',
  'qortium-home-dashboard-pins',
  'qortium-home-notification-store',
  'qortium-home-display-settings',
  'qortium-home-text-size',
] as const;

export type WelcomeStatus = 'in-progress' | 'completed' | 'skipped';
export type WelcomeStep = 'node' | 'account' | 'finish';

export type WelcomeState = {
  currentStep: WelcomeStep;
  status: WelcomeStatus;
  updatedAt: string;
  version: 1;
};

export type WelcomeProfileFootprint = {
  hasAccounts: boolean;
  hasDesktopNodeSettings?: boolean;
  hasDesktopNotificationStore?: boolean;
  storedValues: Partial<Record<(typeof PROFILE_FOOTPRINT_STORAGE_KEYS)[number], string | null>>;
};

function isWelcomeStatus(value: unknown): value is WelcomeStatus {
  return value === 'in-progress' || value === 'completed' || value === 'skipped';
}

function isWelcomeStep(value: unknown): value is WelcomeStep {
  return value === 'node' || value === 'account' || value === 'finish';
}

function now() {
  return new Date().toISOString();
}

export function createWelcomeState(
  status: WelcomeStatus = 'in-progress',
  currentStep: WelcomeStep = 'node',
  updatedAt = now(),
): WelcomeState {
  return {
    currentStep,
    status,
    updatedAt,
    version: 1,
  };
}

export function normalizeWelcomeState(value: unknown): WelcomeState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const state = value as Partial<WelcomeState>;

  if (state.version !== 1 || !isWelcomeStatus(state.status) || !isWelcomeStep(state.currentStep)) {
    return null;
  }

  const updatedAt = typeof state.updatedAt === 'string' ? state.updatedAt.trim() : '';

  if (!updatedAt || Number.isNaN(Date.parse(updatedAt))) {
    return null;
  }

  return {
    currentStep: state.currentStep,
    status: state.status,
    updatedAt,
    version: 1,
  };
}

export function getInitialWelcomeStep(state: WelcomeState): WelcomeStep {
  // Reopening a finished (completed or skipped) wizard via home://welcome
  // restarts it from the first step; an in-progress one resumes where it
  // left off. Merely viewing never rewrites the stored state - status only
  // returns to in-progress once the user actually advances a step.
  return state.status === 'in-progress' ? state.currentStep : 'node';
}

export function hasExistingProfileFootprint({
  hasAccounts,
  hasDesktopNodeSettings = false,
  hasDesktopNotificationStore = false,
  storedValues,
}: WelcomeProfileFootprint) {
  if (hasAccounts || hasDesktopNodeSettings || hasDesktopNotificationStore) {
    return true;
  }

  return Object.values(storedValues).some((value) => typeof value === 'string' && value.trim().length > 0);
}

async function getStoredValue(key: string) {
  if (Capacitor.isNativePlatform()) {
    return (await Preferences.get({ key })).value;
  }

  return window.localStorage.getItem(key);
}

async function setStoredValue(key: string, value: string) {
  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key, value });
    return;
  }

  window.localStorage.setItem(key, value);
}

async function loadProfileFootprint(hasAccounts: boolean): Promise<WelcomeProfileFootprint> {
  const hasDesktopNodeSettings = await window.qortiumHome?.node?.hasStoredSettings?.() ?? false;
  const hasDesktopNotificationStore = await window.qortiumHome?.qdn?.hasNotificationStore?.() ?? false;
  const storageKeys = window.qortiumHome?.node?.hasStoredSettings || window.qortiumHome?.qdn?.hasNotificationStore
    ? PROFILE_FOOTPRINT_STORAGE_KEYS.filter(
      (key) => key !== 'qortium-home-node-settings' && key !== 'qortium-home-notification-store',
    )
    : PROFILE_FOOTPRINT_STORAGE_KEYS;
  const values = await Promise.all(
    storageKeys.map(async (key) => [key, await getStoredValue(key)] as const),
  );

  return {
    hasAccounts,
    hasDesktopNodeSettings,
    hasDesktopNotificationStore,
    storedValues: Object.fromEntries(values),
  };
}

export async function loadWelcomeState({ hasAccounts = false }: { hasAccounts?: boolean } = {}): Promise<WelcomeState> {
  const raw = await getStoredValue(WELCOME_STATE_STORAGE_KEY);

  if (raw) {
    try {
      const state = normalizeWelcomeState(JSON.parse(raw));

      if (state) {
        return state;
      }
    } catch {
      // Treat malformed data as an absent marker and preserve any legacy profile.
    }
  }

  const footprint = await loadProfileFootprint(hasAccounts);
  const state = hasExistingProfileFootprint(footprint)
    ? createWelcomeState('skipped', 'finish')
    : createWelcomeState();

  await saveWelcomeState(state);
  return state;
}

export async function saveWelcomeState(state: WelcomeState): Promise<void> {
  const normalized = normalizeWelcomeState(state);

  if (!normalized) {
    throw new Error('Invalid welcome state.');
  }

  await setStoredValue(WELCOME_STATE_STORAGE_KEY, JSON.stringify(normalized));
}
