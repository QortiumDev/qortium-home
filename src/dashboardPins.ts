import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const DASHBOARD_PINS_STORAGE_KEY = 'qortium-home-dashboard-pins';
const MAX_DASHBOARD_PINS = 32;

export type DashboardPin = {
  createdAt: number;
  displayUrl: string;
  id: string;
  label: string;
};

function normalizePinLabel(label: unknown, displayUrl: string) {
  return typeof label === 'string' && label.trim() ? label.trim() : displayUrl;
}

function normalizePin(value: unknown): DashboardPin | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const pin = value as Partial<DashboardPin>;
  const displayUrl = typeof pin.displayUrl === 'string' ? pin.displayUrl.trim() : '';

  if (!displayUrl) {
    return null;
  }

  return {
    createdAt: typeof pin.createdAt === 'number' && Number.isFinite(pin.createdAt) ? pin.createdAt : Date.now(),
    displayUrl,
    id: displayUrl,
    label: normalizePinLabel(pin.label, displayUrl),
  };
}

function normalizePins(value: unknown): DashboardPin[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const pins = new Map<string, DashboardPin>();

  for (const item of value) {
    const pin = normalizePin(item);

    if (pin && !pins.has(pin.displayUrl)) {
      pins.set(pin.displayUrl, pin);
    }
  }

  return [...pins.values()].slice(0, MAX_DASHBOARD_PINS);
}

export function createDashboardPin(displayUrl: string, label: string): DashboardPin | null {
  const normalizedDisplayUrl = displayUrl.trim();

  if (!normalizedDisplayUrl) {
    return null;
  }

  return {
    createdAt: Date.now(),
    displayUrl: normalizedDisplayUrl,
    id: normalizedDisplayUrl,
    label: normalizePinLabel(label, normalizedDisplayUrl),
  };
}

export function upsertDashboardPin(currentPins: DashboardPin[], nextPin: DashboardPin): DashboardPin[] {
  return [
    nextPin,
    ...currentPins.filter((pin) => pin.displayUrl !== nextPin.displayUrl),
  ].slice(0, MAX_DASHBOARD_PINS);
}

export function removeDashboardPin(currentPins: DashboardPin[], pinId: string): DashboardPin[] {
  return currentPins.filter((pin) => pin.id !== pinId);
}

export async function loadDashboardPins(): Promise<DashboardPin[]> {
  const serializedPins = Capacitor.isNativePlatform()
    ? (await Preferences.get({ key: DASHBOARD_PINS_STORAGE_KEY })).value
    : window.localStorage.getItem(DASHBOARD_PINS_STORAGE_KEY);

  if (!serializedPins) {
    return [];
  }

  try {
    return normalizePins(JSON.parse(serializedPins));
  } catch {
    return [];
  }
}

export async function saveDashboardPins(pins: DashboardPin[]) {
  const serializedPins = JSON.stringify(normalizePins(pins));

  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key: DASHBOARD_PINS_STORAGE_KEY, value: serializedPins });
    return;
  }

  window.localStorage.setItem(DASHBOARD_PINS_STORAGE_KEY, serializedPins);
}
