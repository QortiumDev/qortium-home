import type { ConcreteLanguageSetting } from '../displaySettings'

export type HomeV2ThemePreference = 'system' | 'light' | 'dark'
export type HomeV2ResolvedTheme = 'light' | 'dark'
export type HomeV2Accent =
  | 'clay'
  | 'green'
  | 'blue'
  | 'orange'
  | 'purple'
  | 'red'
  | 'teal'
  | 'cyan'
  | 'pink'
  | 'yellow'
export type HomeV2TextSize =
  | 'extra-small'
  | 'small'
  | 'medium'
  | 'large'
  | 'extra-large'
  | 'huge'
export type HomeV2Language = 'system' | ConcreteLanguageSetting
export type HomeV2ResolvedLanguage = ConcreteLanguageSetting

export interface HomeV2AppearanceSettings {
  readonly theme: HomeV2ThemePreference
  readonly resolvedTheme: HomeV2ResolvedTheme
  readonly accent: HomeV2Accent
  readonly textSize: HomeV2TextSize
  readonly appZoom: number
  readonly language: HomeV2Language
  readonly resolvedLanguage: HomeV2ResolvedLanguage
}

export interface LegacyDisplaySettingsInput {
  readonly theme?: unknown
  readonly accent?: unknown
  readonly textSize?: unknown
  readonly appZoom?: unknown
  readonly language?: unknown
  readonly ui?: unknown
}

export const homeV2ThemeOptions = [
  { value: 'system', labelKey: 'display.theme.system' },
  { value: 'light', labelKey: 'display.theme.light' },
  { value: 'dark', labelKey: 'display.theme.dark' },
] as const satisfies readonly {
  readonly value: HomeV2ThemePreference
  readonly labelKey: import('../i18n').TranslationKey
}[]

export const homeV2AccentOptions = [
  { value: 'clay', labelKey: 'home2.settings.clay', swatch: '#9a6750' },
  { value: 'green', labelKey: 'display.accent.green', swatch: '#39775a' },
  { value: 'blue', labelKey: 'display.accent.blue', swatch: '#4a6f9e' },
  { value: 'orange', labelKey: 'display.accent.orange', swatch: '#b76c35' },
  { value: 'purple', labelKey: 'display.accent.purple', swatch: '#765c91' },
  { value: 'red', labelKey: 'display.accent.red', swatch: '#a64f4b' },
  { value: 'teal', labelKey: 'display.accent.teal', swatch: '#397879' },
  { value: 'cyan', labelKey: 'display.accent.cyan', swatch: '#3e7d91' },
  { value: 'pink', labelKey: 'display.accent.pink', swatch: '#9a5875' },
  { value: 'yellow', labelKey: 'display.accent.yellow', swatch: '#a57d2f' },
] as const satisfies readonly {
  readonly value: HomeV2Accent
  readonly labelKey: import('../i18n').TranslationKey
  readonly swatch: string
}[]

export const homeV2TextSizeOptions = [
  { value: 'extra-small', labelKey: 'home2.settings.textSize.extraSmall' },
  { value: 'small', labelKey: 'display.textSize.small' },
  { value: 'medium', labelKey: 'display.textSize.medium' },
  { value: 'large', labelKey: 'display.textSize.large' },
  { value: 'extra-large', labelKey: 'home2.settings.textSize.extraLarge' },
  { value: 'huge', labelKey: 'display.textSize.huge' },
] as const satisfies readonly {
  readonly value: HomeV2TextSize
  readonly labelKey: import('../i18n').TranslationKey
}[]

export const homeV2LanguageOptions = [
  { value: 'system', label: 'System language' },
  { value: 'ar', label: 'العربية' },
  { value: 'de', label: 'Deutsch' },
  { value: 'el', label: 'Ελληνικά' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'et', label: 'Eesti' },
  { value: 'fi', label: 'Suomi' },
  { value: 'fr', label: 'Français' },
  { value: 'he', label: 'עברית' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'hu', label: 'Magyar' },
  { value: 'it', label: 'Italiano' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'nb', label: 'Norsk bokmål' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'pl', label: 'Polski' },
  { value: 'pt', label: 'Português' },
  { value: 'ro', label: 'Română' },
  { value: 'ru', label: 'Русский' },
  { value: 'sv', label: 'Svenska' },
  { value: 'zh-CN', label: '中文（简体）' },
  { value: 'zh-TW', label: '中文（繁體）' },
] as const satisfies readonly {
  readonly value: HomeV2Language
  readonly label: string
}[]

export const defaultHomeV2Appearance: HomeV2AppearanceSettings = {
  theme: 'system',
  resolvedTheme: 'light',
  accent: 'clay',
  textSize: 'medium',
  appZoom: 100,
  language: 'system',
  resolvedLanguage: 'en',
}

function optionValue<Value extends string>(
  value: unknown,
  options: readonly { readonly value: Value }[],
): Value | null {
  return options.some((option) => option.value === value)
    ? (value as Value)
    : null
}

export function clampHomeV2AppZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100
  return Math.max(50, Math.min(200, Math.round(value)))
}

export function resolveHomeV2SystemLanguage(
  candidate: string | null | undefined,
): HomeV2ResolvedLanguage {
  if (!candidate) return 'en'
  const tag = candidate.toLowerCase()
  const exact = homeV2LanguageOptions.find(
    (option) => option.value !== 'system' && option.value.toLowerCase() === tag,
  )
  if (exact && exact.value !== 'system') return exact.value
  if (tag.startsWith('zh')) return /tw|hk|mo|hant/.test(tag) ? 'zh-TW' : 'zh-CN'
  const base = tag.split('-')[0]
  if (base === 'no') return 'nb'
  const baseMatch = homeV2LanguageOptions.find(
    (option) => option.value !== 'system' && option.value === base,
  )
  return baseMatch && baseMatch.value !== 'system' ? baseMatch.value : 'en'
}

export function isHomeV2RtlLanguage(
  language: HomeV2ResolvedLanguage,
): boolean {
  return language === 'ar' || language === 'he'
}

export function migrateLegacyAppearance(
  legacy: LegacyDisplaySettingsInput | null | undefined,
  systemTheme: HomeV2ResolvedTheme = 'light',
  systemLanguage: HomeV2ResolvedLanguage = 'en',
): HomeV2AppearanceSettings {
  const theme =
    optionValue(legacy?.theme, homeV2ThemeOptions) ??
    defaultHomeV2Appearance.theme

  const language =
    optionValue(legacy?.language, homeV2LanguageOptions) ??
    defaultHomeV2Appearance.language

  return {
    theme,
    resolvedTheme: theme === 'system' ? systemTheme : theme,
    accent:
      optionValue(legacy?.accent, homeV2AccentOptions) ??
      defaultHomeV2Appearance.accent,
    textSize:
      optionValue(legacy?.textSize, homeV2TextSizeOptions) ??
      defaultHomeV2Appearance.textSize,
    appZoom: clampHomeV2AppZoom(legacy?.appZoom),
    language,
    resolvedLanguage: language === 'system' ? systemLanguage : language,
  }
}
