import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { setTranslationLanguage, t, type TranslationKey } from './i18n';

const TEXT_SIZE_STORAGE_KEY = 'qortium-home-text-size';
const DISPLAY_SETTINGS_STORAGE_KEY = 'qortium-home-display-settings';

export const THEME_OPTIONS = [
  {
    labelKey: 'display.theme.system',
    value: 'system',
  },
  {
    labelKey: 'display.theme.light',
    value: 'light',
  },
  {
    labelKey: 'display.theme.dark',
    value: 'dark',
  },
] as const satisfies readonly { labelKey: TranslationKey; value: string }[];

export type ThemeSetting = (typeof THEME_OPTIONS)[number]['value'];
export type ResolvedThemeSetting = Exclude<ThemeSetting, 'system'>;

export const LANGUAGE_OPTIONS = [
  {
    label: 'العربية',
    value: 'ar',
  },
  {
    label: 'Deutsch',
    value: 'de',
  },
  {
    label: 'English',
    value: 'en',
  },
  {
    label: 'Español',
    value: 'es',
  },
  {
    label: 'Eesti',
    value: 'et',
  },
  {
    label: 'Suomi',
    value: 'fi',
  },
  {
    label: 'Français',
    value: 'fr',
  },
  {
    label: 'עברית',
    value: 'he',
  },
  {
    label: 'Magyar',
    value: 'hu',
  },
  {
    label: 'Italiano',
    value: 'it',
  },
  {
    label: '日本語',
    value: 'ja',
  },
  {
    label: '한국어',
    value: 'ko',
  },
  {
    label: 'Nederlands',
    value: 'nl',
  },
  {
    label: 'Polski',
    value: 'pl',
  },
  {
    label: 'Português',
    value: 'pt',
  },
  {
    label: 'Română',
    value: 'ro',
  },
  {
    label: 'Русский',
    value: 'ru',
  },
  {
    label: 'Svenska',
    value: 'sv',
  },
  {
    label: '中文（简体）',
    value: 'zh-CN',
  },
  {
    label: '中文（繁體）',
    value: 'zh-TW',
  },
] as const;

export type LanguageSetting = (typeof LANGUAGE_OPTIONS)[number]['value'];

export const TEXT_SIZE_OPTIONS = [
  {
    labelKey: 'display.textSize.extraSmall',
    value: 'extra-small',
  },
  {
    labelKey: 'display.textSize.small',
    value: 'small',
  },
  {
    labelKey: 'display.textSize.medium',
    value: 'medium',
  },
  {
    labelKey: 'display.textSize.large',
    value: 'large',
  },
  {
    labelKey: 'display.textSize.extraLarge',
    value: 'extra-large',
  },
  {
    labelKey: 'display.textSize.huge',
    value: 'huge',
  },
] as const satisfies readonly { labelKey: TranslationKey; value: string }[];

export type TextSizeSetting = (typeof TEXT_SIZE_OPTIONS)[number]['value'];

export type DisplaySettings = {
  language: LanguageSetting;
  textSize: TextSizeSetting;
  theme: ThemeSetting;
};

export type ResolvedDisplaySettings = Omit<DisplaySettings, 'theme'> & {
  theme: ResolvedThemeSetting;
};

export const SYSTEM_THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';
export const DEFAULT_THEME: ThemeSetting = 'system';
export const DEFAULT_RESOLVED_THEME: ResolvedThemeSetting = 'light';
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
  return t(THEME_OPTIONS.find((option) => option.value === theme)?.labelKey ?? 'display.theme.system');
}

export function getLanguageLabel(language: LanguageSetting) {
  return LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ?? 'English';
}

export function getTextSizeLabel(textSize: TextSizeSetting) {
  return t(TEXT_SIZE_OPTIONS.find((option) => option.value === textSize)?.labelKey ?? 'display.textSize.medium');
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

export function getSystemTheme(): ResolvedThemeSetting {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return DEFAULT_RESOLVED_THEME;
  }

  return window.matchMedia(SYSTEM_THEME_MEDIA_QUERY).matches ? 'dark' : 'light';
}

export function resolveThemeSetting(
  theme: ThemeSetting,
  systemTheme: ResolvedThemeSetting = getSystemTheme(),
): ResolvedThemeSetting {
  return theme === 'system' ? systemTheme : theme;
}

export function resolveDisplaySettings(
  displaySettings: DisplaySettings,
  systemTheme: ResolvedThemeSetting = getSystemTheme(),
): ResolvedDisplaySettings {
  return {
    ...displaySettings,
    theme: resolveThemeSetting(displaySettings.theme, systemTheme),
  };
}

export function subscribeToSystemThemeChange(listener: (theme: ResolvedThemeSetting) => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }

  const mediaQueryList = window.matchMedia(SYSTEM_THEME_MEDIA_QUERY);
  const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
    listener(event.matches ? 'dark' : 'light');
  };

  if (typeof mediaQueryList.addEventListener === 'function') {
    mediaQueryList.addEventListener('change', handleChange);

    return () => mediaQueryList.removeEventListener('change', handleChange);
  }

  mediaQueryList.addListener(handleChange);

  return () => mediaQueryList.removeListener(handleChange);
}

const RTL_LANGUAGES = new Set<LanguageSetting>(['ar', 'he']);

export function isRtlLanguage(language: LanguageSetting) {
  return RTL_LANGUAGES.has(language);
}

function applyDocumentDisplaySettings(displaySettings: ResolvedDisplaySettings) {
  setTranslationLanguage(displaySettings.language);
  document.documentElement.dataset.theme = displaySettings.theme;
  document.documentElement.dataset.language = displaySettings.language;
  document.documentElement.dataset.textSize = displaySettings.textSize;
  document.documentElement.lang = displaySettings.language;
  document.documentElement.dir = isRtlLanguage(displaySettings.language) ? 'rtl' : 'ltr';
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

export function applyDisplaySettings(
  displaySettings: DisplaySettings,
  systemTheme: ResolvedThemeSetting = getSystemTheme(),
) {
  applyDocumentDisplaySettings(resolveDisplaySettings(displaySettings, systemTheme));
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
