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
    label: 'Ελληνικά',
    value: 'el',
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
    label: 'हिन्दी',
    value: 'hi',
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
    label: 'Norsk bokmål',
    value: 'nb',
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

export type ConcreteLanguageSetting = (typeof LANGUAGE_OPTIONS)[number]['value'];
export type LanguageSetting = ConcreteLanguageSetting | 'system';

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

export const TEXT_SIZE_VALUES = TEXT_SIZE_OPTIONS.map((option) => option.value);

export const ACCENT_OPTIONS = [
  {
    labelKey: 'display.accent.green',
    value: 'green',
    swatch: '#21824a',
  },
  {
    labelKey: 'display.accent.blue',
    value: 'blue',
    swatch: '#2a79f3',
  },
  {
    labelKey: 'display.accent.orange',
    value: 'orange',
    swatch: '#de8b23',
  },
  {
    labelKey: 'display.accent.purple',
    value: 'purple',
    swatch: '#7b44da',
  },
  {
    labelKey: 'display.accent.red',
    value: 'red',
    swatch: '#d53e3e',
  },
  {
    labelKey: 'display.accent.teal',
    value: 'teal',
    swatch: '#17a398',
  },
  {
    labelKey: 'display.accent.cyan',
    value: 'cyan',
    swatch: '#1298d8',
  },
  {
    labelKey: 'display.accent.pink',
    value: 'pink',
    swatch: '#d43f86',
  },
  {
    labelKey: 'display.accent.yellow',
    value: 'yellow',
    swatch: '#d6a828',
  },
] as const satisfies readonly { labelKey: TranslationKey; value: string; swatch: string }[];

export type AccentSetting = (typeof ACCENT_OPTIONS)[number]['value'];

export type UiSetting = 'classic' | 'modern';

export const UI_OPTIONS: ReadonlyArray<{ value: UiSetting; labelKey: TranslationKey }> = [
  { value: 'classic', labelKey: 'display.ui.classic' },
  { value: 'modern', labelKey: 'display.ui.modern' },
];

export const DEFAULT_UI: UiSetting = 'classic';
export const DEFAULT_APP_ZOOM = 100;
export const MIN_APP_ZOOM = 50;
export const MAX_APP_ZOOM = 200;
export const APP_ZOOM_LEVEL_STEP = 0.5;
export const MIN_APP_ZOOM_LEVEL = -3;
export const MAX_APP_ZOOM_LEVEL = 3;

const APP_ZOOM_LEVEL_BASE = 1.2;

export type DisplaySettings = {
  appZoom: number;
  language: LanguageSetting;
  textSize: TextSizeSetting;
  theme: ThemeSetting;
  accent: AccentSetting;
  ui: UiSetting;
};

export type ResolvedDisplaySettings = Omit<DisplaySettings, 'language' | 'theme'> & {
  language: ConcreteLanguageSetting;
  theme: ResolvedThemeSetting;
};

export const SYSTEM_THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';
export const DEFAULT_THEME: ThemeSetting = 'system';
export const DEFAULT_RESOLVED_THEME: ResolvedThemeSetting = 'light';
export const DEFAULT_LANGUAGE: LanguageSetting = 'system';
export const DEFAULT_RESOLVED_LANGUAGE: ConcreteLanguageSetting = 'en';
export const DEFAULT_TEXT_SIZE: TextSizeSetting = 'medium';
export const DEFAULT_ACCENT: AccentSetting = 'green';

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  appZoom: DEFAULT_APP_ZOOM,
  language: DEFAULT_LANGUAGE,
  textSize: DEFAULT_TEXT_SIZE,
  theme: DEFAULT_THEME,
  accent: DEFAULT_ACCENT,
  ui: DEFAULT_UI,
};

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return THEME_OPTIONS.some((option) => option.value === value);
}

export function isLanguageSetting(value: unknown): value is LanguageSetting {
  return value === 'system' || LANGUAGE_OPTIONS.some((option) => option.value === value);
}

export function isTextSizeSetting(value: unknown): value is TextSizeSetting {
  return TEXT_SIZE_OPTIONS.some((option) => option.value === value);
}

export function isAccentSetting(value: unknown): value is AccentSetting {
  return ACCENT_OPTIONS.some((option) => option.value === value);
}

export function isUiSetting(value: unknown): value is UiSetting {
  return UI_OPTIONS.some((option) => option.value === value);
}

export function getThemeLabel(theme: ThemeSetting) {
  return t(THEME_OPTIONS.find((option) => option.value === theme)?.labelKey ?? 'display.theme.system');
}

export function getLanguageLabel(language: LanguageSetting) {
  if (language === 'system') {
    return t('display.languageSystem');
  }

  return LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ?? 'English';
}

export function getTextSizeLabel(textSize: TextSizeSetting) {
  return t(TEXT_SIZE_OPTIONS.find((option) => option.value === textSize)?.labelKey ?? 'display.textSize.medium');
}

export function nextTextSize(textSize: TextSizeSetting): TextSizeSetting {
  const index = TEXT_SIZE_VALUES.indexOf(textSize);
  if (index === -1) {
    return DEFAULT_TEXT_SIZE;
  }
  const nextIndex = Math.min(index + 1, TEXT_SIZE_VALUES.length - 1);

  return TEXT_SIZE_VALUES[nextIndex];
}

export function prevTextSize(textSize: TextSizeSetting): TextSizeSetting {
  const index = TEXT_SIZE_VALUES.indexOf(textSize);
  if (index === -1) {
    return DEFAULT_TEXT_SIZE;
  }
  const prevIndex = Math.max(index - 1, 0);

  return TEXT_SIZE_VALUES[prevIndex];
}

export function clampAppZoom(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_APP_ZOOM;
  }

  return Math.max(MIN_APP_ZOOM, Math.min(MAX_APP_ZOOM, Math.round(value)));
}

function clampAppZoomLevel(level: number) {
  return Math.max(MIN_APP_ZOOM_LEVEL, Math.min(MAX_APP_ZOOM_LEVEL, level));
}

export function appZoomPercentToLevel(percent: number) {
  return Math.log(clampAppZoom(percent) / 100) / Math.log(APP_ZOOM_LEVEL_BASE);
}

export function appZoomLevelToPercent(level: number) {
  return clampAppZoom(Math.round(100 * Math.pow(APP_ZOOM_LEVEL_BASE, clampAppZoomLevel(level))));
}

export function stepAppZoom(percent: number, direction: 'in' | 'out', useZoomLevelStep: boolean) {
  if (!useZoomLevelStep) {
    return clampAppZoom(percent + (direction === 'in' ? 10 : -10));
  }

  const level = appZoomPercentToLevel(percent) + (direction === 'in' ? APP_ZOOM_LEVEL_STEP : -APP_ZOOM_LEVEL_STEP);

  return appZoomLevelToPercent(level);
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
    appZoom: clampAppZoom(settings.appZoom),
    language: isLanguageSetting(settings.language) ? settings.language : DEFAULT_LANGUAGE,
    textSize: isTextSizeSetting(settings.textSize) ? settings.textSize : fallbackTextSize,
    theme: isThemeSetting(settings.theme) ? settings.theme : DEFAULT_THEME,
    accent: isAccentSetting(settings.accent) ? settings.accent : DEFAULT_ACCENT,
    ui: isUiSetting(settings.ui) ? settings.ui : DEFAULT_UI,
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

export function getSystemLanguage(): ConcreteLanguageSetting {
  if (typeof navigator === 'undefined') {
    return DEFAULT_RESOLVED_LANGUAGE;
  }

  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const tag = candidate.toLowerCase();
    const exact = LANGUAGE_OPTIONS.find((option) => option.value.toLowerCase() === tag);

    if (exact) {
      return exact.value;
    }

    if (tag.startsWith('zh')) {
      return /tw|hk|mo|hant/.test(tag) ? 'zh-TW' : 'zh-CN';
    }

    const base = tag.split('-')[0];
    if (base === 'no') {
      return 'nb';
    }

    const baseMatch = LANGUAGE_OPTIONS.find((option) => option.value === base);

    if (baseMatch) {
      return baseMatch.value;
    }
  }

  return DEFAULT_RESOLVED_LANGUAGE;
}

export function resolveLanguageSetting(
  language: LanguageSetting,
  systemLanguage: ConcreteLanguageSetting = getSystemLanguage(),
): ConcreteLanguageSetting {
  return language === 'system' ? systemLanguage : language;
}

export function resolveDisplaySettings(
  displaySettings: DisplaySettings,
  systemTheme: ResolvedThemeSetting = getSystemTheme(),
  systemLanguage: ConcreteLanguageSetting = getSystemLanguage(),
): ResolvedDisplaySettings {
  return {
    ...displaySettings,
    language: resolveLanguageSetting(displaySettings.language, systemLanguage),
    theme: resolveThemeSetting(displaySettings.theme, systemTheme),
  };
}

export function subscribeToSystemLanguageChange(listener: (language: ConcreteLanguageSetting) => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleChange = () => {
    listener(getSystemLanguage());
  };

  window.addEventListener('languagechange', handleChange);

  return () => window.removeEventListener('languagechange', handleChange);
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

const RTL_LANGUAGES = new Set<ConcreteLanguageSetting>(['ar', 'he']);

export function isRtlLanguage(language: ConcreteLanguageSetting) {
  return RTL_LANGUAGES.has(language);
}

function applyDocumentDisplaySettings(displaySettings: ResolvedDisplaySettings) {
  setTranslationLanguage(displaySettings.language);
  document.documentElement.dataset.theme = displaySettings.theme;
  document.documentElement.dataset.language = displaySettings.language;
  document.documentElement.dataset.textSize = displaySettings.textSize;
  document.documentElement.dataset.accent = displaySettings.accent;
  document.documentElement.dataset.ui = displaySettings.ui;
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
  systemLanguage: ConcreteLanguageSetting = getSystemLanguage(),
) {
  applyDocumentDisplaySettings(resolveDisplaySettings(displaySettings, systemTheme, systemLanguage));
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
