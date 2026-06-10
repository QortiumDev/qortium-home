import type { LanguageSetting } from '../displaySettings';
import { ar } from './locales/ar';
import { de } from './locales/de';
import { en, type TranslationKey } from './locales/en';
import { es } from './locales/es';
import { et } from './locales/et';
import { fi } from './locales/fi';
import { fr } from './locales/fr';
import { he } from './locales/he';
import { hu } from './locales/hu';
import { it } from './locales/it';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { nl } from './locales/nl';
import { pl } from './locales/pl';
import { pt } from './locales/pt';
import { ro } from './locales/ro';
import { ru } from './locales/ru';
import { sv } from './locales/sv';
import { zhCN } from './locales/zh-CN';
import { zhTW } from './locales/zh-TW';

export type { TranslationKey };

export type TranslationParams = Record<string, string | number>;

const CATALOGS: Record<LanguageSetting, Record<TranslationKey, string>> = {
  ar,
  de,
  en,
  es,
  et,
  fi,
  fr,
  he,
  hu,
  it,
  ja,
  ko,
  nl,
  pl,
  pt,
  ro,
  ru,
  sv,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
};

let currentLanguage: LanguageSetting = 'en';

export function setTranslationLanguage(language: LanguageSetting) {
  currentLanguage = language;
}

export function getTranslationLanguage(): LanguageSetting {
  return currentLanguage;
}

export function t(key: TranslationKey, params?: TranslationParams): string {
  const template = CATALOGS[currentLanguage][key] ?? en[key];

  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
