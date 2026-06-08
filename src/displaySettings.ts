import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const TEXT_SIZE_STORAGE_KEY = 'qortium-home-text-size';
const DISPLAY_SETTINGS_STORAGE_KEY = 'qortium-home-display-settings';

export const THEME_OPTIONS = [
  {
    label: 'Light',
    value: 'light',
  },
  {
    label: 'Dark',
    value: 'dark',
  },
] as const;

export type ThemeSetting = (typeof THEME_OPTIONS)[number]['value'];

export const LANGUAGE_OPTIONS = [
  {
    label: 'English',
    value: 'en',
  },
] as const;

export type LanguageSetting = (typeof LANGUAGE_OPTIONS)[number]['value'];

export const TEXT_SIZE_OPTIONS = [
  {
    label: 'Extra Small',
    value: 'extra-small',
  },
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

export type DisplaySettings = {
  language: LanguageSetting;
  textSize: TextSizeSetting;
  theme: ThemeSetting;
};

export const DEFAULT_THEME: ThemeSetting = 'light';
export const DEFAULT_LANGUAGE: LanguageSetting = 'en';
export const DEFAULT_TEXT_SIZE: TextSizeSetting = 'medium';

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  language: DEFAULT_LANGUAGE,
  textSize: DEFAULT_TEXT_SIZE,
  theme: DEFAULT_THEME,
};

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return THEME_OPTIONS.some((option) => option.value === value);
}

export function isLanguageSetting(value: unknown): value is LanguageSetting {
  return LANGUAGE_OPTIONS.some((option) => option.value === value);
}

export function isTextSizeSetting(value: unknown): value is TextSizeSetting {
  return TEXT_SIZE_OPTIONS.some((option) => option.value === value);
}

export function getThemeLabel(theme: ThemeSetting) {
  return THEME_OPTIONS.find((option) => option.value === theme)?.label ?? 'Light';
}

export function getLanguageLabel(language: LanguageSetting) {
  return LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ?? 'English';
}

export function getTextSizeLabel(textSize: TextSizeSetting) {
  return TEXT_SIZE_OPTIONS.find((option) => option.value === textSize)?.label ?? 'Medium';
}

function normalizeDisplaySettings(value: unknown, fallbackTextSize = DEFAULT_TEXT_SIZE): DisplaySettings {
  if (!value || typeof value !== 'object') {
    return {
      ...DEFAULT_DISPLAY_SETTINGS,
      textSize: fallbackTextSize,
    };
  }

  const settings = value as Partial<Record<keyof DisplaySettings, unknown>>;

  return {
    language: isLanguageSetting(settings.language) ? settings.language : DEFAULT_LANGUAGE,
    textSize: isTextSizeSetting(settings.textSize) ? settings.textSize : fallbackTextSize,
    theme: isThemeSetting(settings.theme) ? settings.theme : DEFAULT_THEME,
  };
}

function parseDisplaySettings(value: string | null, fallbackTextSize = DEFAULT_TEXT_SIZE): DisplaySettings {
  if (!value) {
    return {
      ...DEFAULT_DISPLAY_SETTINGS,
      textSize: fallbackTextSize,
    };
  }

  try {
    return normalizeDisplaySettings(JSON.parse(value), fallbackTextSize);
  } catch {
    return {
      ...DEFAULT_DISPLAY_SETTINGS,
      textSize: fallbackTextSize,
    };
  }
}

function applyDocumentDisplaySettings(displaySettings: DisplaySettings) {
  document.documentElement.dataset.theme = displaySettings.theme;
  document.documentElement.dataset.language = displaySettings.language;
  document.documentElement.dataset.textSize = displaySettings.textSize;
  document.documentElement.lang = displaySettings.language;
  document.documentElement.style.colorScheme = displaySettings.theme;
}

export function getInitialDisplaySettings(): DisplaySettings {
  if (Capacitor.isNativePlatform()) {
    return DEFAULT_DISPLAY_SETTINGS;
  }

  try {
    const storedDisplaySettings = window.localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY);
    const storedTextSize = window.localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
    const fallbackTextSize = isTextSizeSetting(storedTextSize) ? storedTextSize : DEFAULT_TEXT_SIZE;

    return parseDisplaySettings(storedDisplaySettings, fallbackTextSize);
  } catch {
    return DEFAULT_DISPLAY_SETTINGS;
  }
}

export function applyDisplaySettings(displaySettings: DisplaySettings) {
  applyDocumentDisplaySettings(displaySettings);
}

export async function loadDisplaySettings() {
  if (Capacitor.isNativePlatform()) {
    const storedDisplaySettings = (await Preferences.get({ key: DISPLAY_SETTINGS_STORAGE_KEY })).value;
    const storedTextSize = (await Preferences.get({ key: TEXT_SIZE_STORAGE_KEY })).value;
    const fallbackTextSize = isTextSizeSetting(storedTextSize) ? storedTextSize : DEFAULT_TEXT_SIZE;

    return parseDisplaySettings(storedDisplaySettings, fallbackTextSize);
  }

  return getInitialDisplaySettings();
}

export async function saveDisplaySettings(displaySettings: DisplaySettings) {
  applyDisplaySettings(displaySettings);
  const serializedSettings = JSON.stringify(displaySettings);

  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key: DISPLAY_SETTINGS_STORAGE_KEY, value: serializedSettings });
    return;
  }

  window.localStorage.setItem(DISPLAY_SETTINGS_STORAGE_KEY, serializedSettings);
}
