import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { LANGUAGE_OPTIONS } from './displaySettings'
import {
  defaultHomeV2Appearance,
  homeV2LanguageOptions,
} from './v2/appearance'
import { SettingsPage } from './v2/shell/SettingsPage'
import { homeV2Fixture } from './v2/test-kit/fixtures'
import {
  getTranslationLanguage,
  setTranslationLanguage,
  subscribeTranslationChange,
  t,
} from './i18n'
import { ar } from './i18n/locales/ar'
import { de } from './i18n/locales/de'
import { el } from './i18n/locales/el'
import { en, type TranslationKey } from './i18n/locales/en'
import { es } from './i18n/locales/es'
import { et } from './i18n/locales/et'
import { fi } from './i18n/locales/fi'
import { fr } from './i18n/locales/fr'
import { he } from './i18n/locales/he'
import { hi } from './i18n/locales/hi'
import { hu } from './i18n/locales/hu'
import { it } from './i18n/locales/it'
import { ja } from './i18n/locales/ja'
import { ko } from './i18n/locales/ko'
import { nb } from './i18n/locales/nb'
import { nl } from './i18n/locales/nl'
import { pl } from './i18n/locales/pl'
import { pt } from './i18n/locales/pt'
import { ro } from './i18n/locales/ro'
import { ru } from './i18n/locales/ru'
import { sv } from './i18n/locales/sv'
import { zhCN } from './i18n/locales/zh-CN'
import { zhTW } from './i18n/locales/zh-TW'
import { translateMainProcessMessage } from './mainProcessMessage'

type Catalog = Record<TranslationKey, string>

const catalogs = {
  ar,
  de,
  el,
  en,
  es,
  et,
  fi,
  fr,
  he,
  hi,
  hu,
  it,
  ja,
  ko,
  nb,
  nl,
  pl,
  pt,
  ro,
  ru,
  sv,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
} satisfies Record<string, Catalog>

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort()
}

async function switchToFreshLocale(language: 'fr'): Promise<number> {
  let notifications = 0

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Timed out loading the ${language} translation catalog.`))
    }, 2_000)
    const unsubscribe = subscribeTranslationChange(() => {
      notifications += 1
      clearTimeout(timeout)
      unsubscribe()
      resolve()
    })

    setTranslationLanguage(language)
  })

  return notifications
}

function renderSettings(): string {
  return renderToStaticMarkup(
    <SettingsPage
      account={{
        lockOnExit: true,
        manuallyLocked: false,
        rememberUnlock: false,
        secureStorageAvailable: true,
        selectedIdentityId: null,
        state: 'none',
      }}
      appearance={defaultHomeV2Appearance}
      nodes={homeV2Fixture.nodes}
      newTabPreference={{ kind: 'search' }}
    />,
  )
}

async function main() {
  const englishKeys = Object.keys(en).sort()
  const displayLanguageCodes = LANGUAGE_OPTIONS.map((option) => option.value)
  const homeV2LanguageCodes = homeV2LanguageOptions
    .filter((option) => option.value !== 'system')
    .map((option) => option.value)

  assert.deepEqual(
    homeV2LanguageCodes,
    displayLanguageCodes,
    'Home 2 language options must exactly match the shared concrete language options',
  )
  assert.deepEqual(
    Object.keys(catalogs),
    displayLanguageCodes,
    'every selectable language must have a locale catalog',
  )

  for (const [language, catalog] of Object.entries(catalogs)) {
    assert.deepEqual(
      Object.keys(catalog).sort(),
      englishKeys,
      `${language} must contain exactly the English translation keys`,
    )

    for (const key of englishKeys as TranslationKey[]) {
      assert.deepEqual(
        placeholders(catalog[key]),
        placeholders(en[key]),
        `${language}.${key} must preserve the English interpolation parameters`,
      )
    }
  }

  setTranslationLanguage('en')
  assert.equal(getTranslationLanguage(), 'en')
  assert.equal(t('common.cancel'), 'Cancel')
  assert.equal(
    t('account.savedWalletBackup', { fileName: 'vault.json' }),
    'Saved wallet backup as vault.json.',
  )
  assert.equal(
    t('account.savedWalletBackup'),
    'Saved wallet backup as {fileName}.',
    'missing interpolation values should remain visible rather than disappear',
  )

  const englishSettings = renderSettings()
  assert.match(englishSettings, />Settings</)

  assert.equal(await switchToFreshLocale('fr'), 1)
  assert.equal(getTranslationLanguage(), 'fr')
  assert.equal(t('common.cancel'), 'Annuler')
  assert.match(
    renderSettings(),
    />Paramètres</,
    'Home 2 should render from the shared catalog after a live language switch',
  )

  setTranslationLanguage('en')
  const encodedParams = encodeURIComponent(JSON.stringify({ status: 503 }))
  assert.equal(
    translateMainProcessMessage(
      `Update failed: QORTIUM_I18N:core.error.onChainHttp:${encodedParams}`,
    ),
    'Core on-chain update status check failed with HTTP 503.',
    'messages emitted by the Core manager should decode their parameters',
  )
  assert.equal(
    translateMainProcessMessage('QORTIUM_I18N:common.cancel:not-json'),
    'Cancel',
    'malformed main-process parameters should still translate the message key',
  )
  assert.equal(
    translateMainProcessMessage('A plain main-process error.'),
    'A plain main-process error.',
  )

  console.log(
    `i18n tests passed: ${Object.keys(catalogs).length} complete locale catalogs, runtime switching, Home 2 rendering, and main-process messages.`,
  )
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
