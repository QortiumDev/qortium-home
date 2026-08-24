import { useState, type ReactNode } from 'react'
import { t } from '../../i18n'
import {
  BOOKMARK_TOOLBAR_VISIBILITIES,
  type BookmarkToolbarVisibility,
} from '../../bookmarkToolbar'
import {
  homeV2AccentOptions,
  homeV2LanguageOptions,
  homeV2TextSizeOptions,
  homeV2ThemeOptions,
  type HomeV2Accent,
  type HomeV2AppearanceSettings,
  type HomeV2Language,
  type HomeV2TextSize,
  type HomeV2ThemePreference,
} from '../appearance'
import type { AccountSessionSummary } from '../contracts'

export interface AppearanceSettingsPageProps {
  readonly appearance: HomeV2AppearanceSettings
  readonly account: AccountSessionSummary
  readonly onSetTheme?: (theme: HomeV2ThemePreference) => void
  readonly onSetAccent?: (accent: HomeV2Accent) => void
  readonly onSetTextSize?: (textSize: HomeV2TextSize) => void
  readonly onSetAppZoom?: (appZoom: number) => void
  readonly onSetLanguage?: (language: HomeV2Language) => void
  readonly bookmarkToolbarVisibility?: BookmarkToolbarVisibility
  readonly onSetBookmarkToolbarVisibility?: (
    visibility: BookmarkToolbarVisibility,
  ) => void | Promise<void>
  readonly onToggleRememberUnlock?: () => void
  readonly onToggleLockOnExit?: () => void
  readonly section?: 'account' | 'appearance' | 'all'
  readonly showHeading?: boolean
}

function SettingRow({
  label,
  description,
  children,
}: {
  readonly label: string
  readonly description: string
  readonly children: ReactNode
}) {
  return (
    <div className="home-v2-setting-row">
      <div className="home-v2-setting-row__copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <div className="home-v2-setting-row__control">{children}</div>
    </div>
  )
}

export function AppearanceSettingsPage({
  appearance,
  account,
  onSetTheme,
  onSetAccent,
  onSetTextSize,
  onSetAppZoom,
  onSetLanguage,
  bookmarkToolbarVisibility,
  onSetBookmarkToolbarVisibility,
  onToggleRememberUnlock,
  onToggleLockOnExit,
  section = 'all',
  showHeading = true,
}: AppearanceSettingsPageProps) {
  const [toolbarSaving, setToolbarSaving] = useState(false)
  const [toolbarError, setToolbarError] = useState(false)
  const resolvedThemeLabel = t(
    appearance.resolvedTheme === 'dark'
      ? 'display.theme.dark'
      : 'display.theme.light',
  )
  return (
    <section className="home-v2-settings-page">
      {showHeading ? (
        <header className="home-v2-page-heading">
          <h1>{t('common.settings')}</h1>
        </header>
      ) : null}

      {section !== 'account' ? (
        <section
          className="home-v2-settings-panel"
          aria-labelledby="appearance-title"
        >
          <div className="home-v2-settings-panel__heading">
            <h2 id="appearance-title">{t('home2.settings.appearance')}</h2>
            <p>{t('home2.settings.appearanceDescription')}</p>
          </div>

          <SettingRow
            label={t('display.themeLabel')}
            description={
              appearance.theme === 'system'
                ? t('home2.settings.followingSystem', {
                    theme: resolvedThemeLabel,
                  })
                : t('home2.settings.usingMode', {
                    theme: resolvedThemeLabel,
                  })
            }
          >
            <select
              aria-label={t('display.themeLabel')}
              value={appearance.theme}
              disabled={!onSetTheme}
              onChange={(event) =>
                onSetTheme?.(event.target.value as HomeV2ThemePreference)
              }
            >
              {homeV2ThemeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </SettingRow>

          <SettingRow
            label={t('display.accentLabel')}
            description={t('home2.settings.accentDescription')}
          >
            <div className="home-v2-accent-select">
              <span
                aria-hidden="true"
                style={{
                  background: homeV2AccentOptions.find(
                    (option) => option.value === appearance.accent,
                  )?.swatch,
                }}
              />
              <select
                aria-label={t('display.accentLabel')}
                value={appearance.accent}
                disabled={!onSetAccent}
                onChange={(event) =>
                  onSetAccent?.(event.target.value as HomeV2Accent)
                }
              >
                {homeV2AccentOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          </SettingRow>

          <SettingRow
            label={t('display.textSizeLabel')}
            description={t('home2.settings.textSizeDescription')}
          >
            <select
              aria-label={t('display.textSizeLabel')}
              value={appearance.textSize}
              disabled={!onSetTextSize}
              onChange={(event) =>
                onSetTextSize?.(event.target.value as HomeV2TextSize)
              }
            >
              {homeV2TextSizeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </SettingRow>

          <SettingRow
            label={t('home2.settings.pageZoom')}
            description={t('home2.settings.pageZoomDescription')}
          >
            <div
              className="home-v2-zoom-control"
              aria-label={t('home2.settings.pageZoom')}
            >
              <button
                type="button"
                aria-label={t('display.appZoomOut')}
                disabled={!onSetAppZoom || appearance.appZoom <= 50}
                onClick={() =>
                  onSetAppZoom?.(Math.max(50, appearance.appZoom - 10))
                }
              >
                −
              </button>
              <output>{appearance.appZoom}%</output>
              <button
                type="button"
                aria-label={t('display.appZoomIn')}
                disabled={!onSetAppZoom || appearance.appZoom >= 200}
                onClick={() =>
                  onSetAppZoom?.(Math.min(200, appearance.appZoom + 10))
                }
              >
                +
              </button>
              <button
                type="button"
                className="home-v2-zoom-reset"
                disabled={!onSetAppZoom || appearance.appZoom === 100}
                onClick={() => onSetAppZoom?.(100)}
              >
                {t('display.appZoomReset')}
              </button>
            </div>
          </SettingRow>

          <SettingRow
            label={t('display.languageLabel')}
            description={t('home2.settings.languageDescription')}
          >
            <select
              aria-label={t('display.languageLabel')}
              value={appearance.language}
              disabled={!onSetLanguage}
              onChange={(event) =>
                onSetLanguage?.(event.target.value as HomeV2Language)
              }
            >
              {homeV2LanguageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value === 'system'
                    ? t('home2.settings.systemLanguage')
                    : option.label}
                </option>
              ))}
            </select>
          </SettingRow>

          {bookmarkToolbarVisibility || onSetBookmarkToolbarVisibility ? (
            <SettingRow
              label={t('bookmarks.toolbarVisibility')}
              description={
                !bookmarkToolbarVisibility
                  ? t('common.loading')
                  : toolbarSaving
                    ? t('common.saving')
                    : toolbarError
                      ? t('common.error')
                      : t(`bookmarks.toolbarVisibility.${bookmarkToolbarVisibility}`)
              }
            >
              <select
                aria-label={t('bookmarks.toolbarVisibility')}
                value={bookmarkToolbarVisibility ?? 'always'}
                disabled={
                  !bookmarkToolbarVisibility ||
                  !onSetBookmarkToolbarVisibility ||
                  toolbarSaving
                }
                onChange={(event) => {
                  if (!onSetBookmarkToolbarVisibility) return
                  const visibility = event.target.value as BookmarkToolbarVisibility
                  setToolbarSaving(true)
                  setToolbarError(false)
                  void Promise.resolve(onSetBookmarkToolbarVisibility(visibility))
                    .catch(() => setToolbarError(true))
                    .finally(() => setToolbarSaving(false))
                }}
              >
                {BOOKMARK_TOOLBAR_VISIBILITIES.map((visibility) => (
                  <option key={visibility} value={visibility}>
                    {t(`bookmarks.toolbarVisibility.${visibility}`)}
                  </option>
                ))}
              </select>
            </SettingRow>
          ) : null}
        </section>
      ) : null}

      {section !== 'appearance' && account.state !== 'none' ? (
        <section
          className="home-v2-settings-panel"
          aria-labelledby="account-security-title"
        >
          <div className="home-v2-settings-panel__heading">
            <h2 id="account-security-title">{t('home2.settings.accountSecurity')}</h2>
            <p>{t('home2.settings.accountSecurityDescription')}</p>
          </div>

          <SettingRow
            label={t('home2.settings.rememberUnlock')}
            description={
              account.secureStorageAvailable
                ? t('home2.settings.rememberUnlockDescription')
                : t('home2.settings.secureStorageUnavailable')
            }
          >
            <label className="home-v2-toggle-control">
              <input
                type="checkbox"
                checked={account.rememberUnlock}
                disabled={!account.secureStorageAvailable}
                readOnly={!onToggleRememberUnlock}
                onChange={onToggleRememberUnlock}
              />
              <span>
                {t(
                  account.rememberUnlock
                    ? 'home2.settings.enabled'
                    : 'home2.settings.disabled',
                )}
              </span>
            </label>
          </SettingRow>

          <SettingRow
            label={t('home2.settings.lockOnExit')}
            description={t('home2.settings.lockOnExitDescription')}
          >
            <label className="home-v2-toggle-control">
              <input
                type="checkbox"
                checked={account.lockOnExit}
                disabled={!account.rememberUnlock}
                readOnly={!onToggleLockOnExit}
                onChange={onToggleLockOnExit}
              />
              <span>
                {t(
                  account.lockOnExit
                    ? 'home2.settings.enabled'
                    : 'home2.settings.disabled',
                )}
              </span>
            </label>
          </SettingRow>
        </section>
      ) : null}
    </section>
  )
}
