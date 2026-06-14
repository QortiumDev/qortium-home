import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const DASHBOARD_PINS_STORAGE_KEY = 'qortium-home-dashboard-pins';
const MAX_DASHBOARD_PINS = 32;

export type DashboardPin = {
  createdAt: number;
  // User-set label that overrides the auto-derived display label. Absent/empty => derive from displayUrl.
  customLabel?: string;
  displayUrl: string;
  id: string;
  label: string;
};

export type DashboardPinDropPosition = 'after' | 'before';

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

  const normalized: DashboardPin = {
    createdAt: typeof pin.createdAt === 'number' && Number.isFinite(pin.createdAt) ? pin.createdAt : Date.now(),
    displayUrl,
    id: displayUrl,
    label: normalizePinLabel(pin.label, displayUrl),
  };

  if (typeof pin.customLabel === 'string' && pin.customLabel.trim()) {
    normalized.customLabel = pin.customLabel.trim();
  }

  return normalized;
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
  // Preserve a user's custom label when re-pinning a URL that is already pinned.
  const existingCustomLabel = currentPins.find((pin) => pin.displayUrl === nextPin.displayUrl)?.customLabel;
  const mergedPin = existingCustomLabel ? { ...nextPin, customLabel: existingCustomLabel } : nextPin;

  return [
    mergedPin,
    ...currentPins.filter((pin) => pin.displayUrl !== nextPin.displayUrl),
  ].slice(0, MAX_DASHBOARD_PINS);
}

export function removeDashboardPin(currentPins: DashboardPin[], pinId: string): DashboardPin[] {
  return currentPins.filter((pin) => pin.id !== pinId);
}

export function setDashboardPinLabel(
  currentPins: DashboardPin[],
  pinId: string,
  customLabel: string,
): DashboardPin[] {
  const trimmed = customLabel.trim();

  return currentPins.map((pin) => {
    if (pin.id !== pinId) {
      return pin;
    }

    const next: DashboardPin = {
      createdAt: pin.createdAt,
      displayUrl: pin.displayUrl,
      id: pin.id,
      label: pin.label,
    };

    // An empty value clears the override and reverts to the derived label.
    if (trimmed) {
      next.customLabel = trimmed;
    }

    return next;
  });
}

export function reorderDashboardPins(
  currentPins: DashboardPin[],
  draggedPinId: string,
  targetPinId: string,
  dropPosition: DashboardPinDropPosition,
): DashboardPin[] {
  if (draggedPinId === targetPinId) {
    return currentPins;
  }

  const draggedPin = currentPins.find((pin) => pin.id === draggedPinId);

  if (!draggedPin) {
    return currentPins;
  }

  const pinsWithoutDragged = currentPins.filter((pin) => pin.id !== draggedPinId);
  const targetIndex = pinsWithoutDragged.findIndex((pin) => pin.id === targetPinId);

  if (targetIndex === -1) {
    return currentPins;
  }

  const insertIndex = dropPosition === 'after' ? targetIndex + 1 : targetIndex;

  return [
    ...pinsWithoutDragged.slice(0, insertIndex),
    draggedPin,
    ...pinsWithoutDragged.slice(insertIndex),
  ];
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
