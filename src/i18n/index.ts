import type { ConcreteLanguageSetting } from '../displaySettings';
import { en, type TranslationKey } from './locales/en';

export type { TranslationKey };

export type TranslationParams = Record<string, string | number>;

type Catalog = Record<TranslationKey, string>;

// English is the static base/fallback: it ships in the main bundle so the first
// paint never waits on a fetch and every key resolves even before a locale loads.
// Every other language is a dynamic import, so Vite code-splits each catalog into
// its own chunk and only the active language's strings are ever loaded — instead
// of eagerly bundling all ~20 catalogs (hundreds of KB) into the startup bundle.
const LOCALE_LOADERS: Record<Exclude<ConcreteLanguageSetting, 'en'>, () => Promise<Catalog>> = {
  ar: () => import('./locales/ar').then((m) => m.ar),
  de: () => import('./locales/de').then((m) => m.de),
  el: () => import('./locales/el').then((m) => m.el),
  es: () => import('./locales/es').then((m) => m.es),
  et: () => import('./locales/et').then((m) => m.et),
  fi: () => import('./locales/fi').then((m) => m.fi),
  fr: () => import('./locales/fr').then((m) => m.fr),
  he: () => import('./locales/he').then((m) => m.he),
  hi: () => import('./locales/hi').then((m) => m.hi),
  hu: () => import('./locales/hu').then((m) => m.hu),
  it: () => import('./locales/it').then((m) => m.it),
  ja: () => import('./locales/ja').then((m) => m.ja),
  ko: () => import('./locales/ko').then((m) => m.ko),
  nb: () => import('./locales/nb').then((m) => m.nb),
  nl: () => import('./locales/nl').then((m) => m.nl),
  pl: () => import('./locales/pl').then((m) => m.pl),
  pt: () => import('./locales/pt').then((m) => m.pt),
  ro: () => import('./locales/ro').then((m) => m.ro),
  ru: () => import('./locales/ru').then((m) => m.ru),
  sv: () => import('./locales/sv').then((m) => m.sv),
  'zh-CN': () => import('./locales/zh-CN').then((m) => m.zhCN),
  'zh-TW': () => import('./locales/zh-TW').then((m) => m.zhTW),
};

const loadedCatalogs = new Map<ConcreteLanguageSetting, Catalog>([['en', en]]);
const loadingLanguages = new Set<ConcreteLanguageSetting>();
const changeListeners = new Set<() => void>();

let currentLanguage: ConcreteLanguageSetting = 'en';
let currentCatalog: Catalog = en;

function notifyChange() {
  for (const listener of changeListeners) {
    listener();
  }
}

// Subscribe to translation-catalog changes — i.e. when a lazily-loaded locale
// finishes loading and becomes the active catalog. The UI uses this to re-render
// so `t()` calls pick up the freshly-loaded language. Returns an unsubscribe fn.
export function subscribeTranslationChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

export function setTranslationLanguage(language: ConcreteLanguageSetting) {
  currentLanguage = language;

  const loaded = loadedCatalogs.get(language);
  if (loaded) {
    currentCatalog = loaded;
    return;
  }

  // Not loaded yet: render with the English fallback now, fetch the catalog once,
  // then swap it in and notify — but only if it is still the active language by
  // the time it resolves (the user may have switched again meanwhile).
  currentCatalog = en;

  if (loadingLanguages.has(language)) {
    return;
  }
  loadingLanguages.add(language);

  void LOCALE_LOADERS[language as Exclude<ConcreteLanguageSetting, 'en'>]()
    .then((catalog) => {
      loadedCatalogs.set(language, catalog);
      if (currentLanguage === language) {
        currentCatalog = catalog;
        notifyChange();
      }
    })
    .catch(() => {
      // Keep the English fallback if the locale chunk fails to load.
    })
    .finally(() => {
      loadingLanguages.delete(language);
    });
}

export function getTranslationLanguage(): ConcreteLanguageSetting {
  return currentLanguage;
}

export function t(key: TranslationKey, params?: TranslationParams): string {
  const template = currentCatalog[key] ?? en[key];

  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
