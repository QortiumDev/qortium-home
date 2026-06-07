import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const TEXT_SIZE_STORAGE_KEY = 'qortium-home-text-size';

export const TEXT_SIZE_OPTIONS = [
  {
    label: 'Small',
    value: 'small',
  },
  {
    label: 'Medium',
    value: 'medium',
  },
  {
    label: 'Large',
    value: 'large',
  },
  {
    label: 'Extra Large',
    value: 'extra-large',
  },
] as const;

export type TextSizeSetting = (typeof TEXT_SIZE_OPTIONS)[number]['value'];

export const DEFAULT_TEXT_SIZE: TextSizeSetting = 'medium';

export function isTextSizeSetting(value: unknown): value is TextSizeSetting {
  return TEXT_SIZE_OPTIONS.some((option) => option.value === value);
}

export function getTextSizeLabel(textSize: TextSizeSetting) {
  return TEXT_SIZE_OPTIONS.find((option) => option.value === textSize)?.label ?? 'Medium';
}

export function getInitialTextSizeSetting(): TextSizeSetting {
  if (Capacitor.isNativePlatform()) {
    return DEFAULT_TEXT_SIZE;
  }

  try {
    const storedTextSize = window.localStorage.getItem(TEXT_SIZE_STORAGE_KEY);

    return isTextSizeSetting(storedTextSize) ? storedTextSize : DEFAULT_TEXT_SIZE;
  } catch {
    return DEFAULT_TEXT_SIZE;
  }
}

export function applyTextSizeSetting(textSize: TextSizeSetting) {
  document.documentElement.dataset.textSize = textSize;
}

export async function loadTextSizeSetting() {
  if (Capacitor.isNativePlatform()) {
    const storedTextSize = (await Preferences.get({ key: TEXT_SIZE_STORAGE_KEY })).value;

    return isTextSizeSetting(storedTextSize) ? storedTextSize : DEFAULT_TEXT_SIZE;
  }

  return getInitialTextSizeSetting();
}

export async function saveTextSizeSetting(textSize: TextSizeSetting) {
  applyTextSizeSetting(textSize);

  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key: TEXT_SIZE_STORAGE_KEY, value: textSize });
    return;
  }

  window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, textSize);
}
