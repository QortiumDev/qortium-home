import type { ReactNode } from 'react'
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
  readonly onToggleRememberUnlock?: () => void
  readonly onToggleLockOnExit?: () => void
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
  onToggleRememberUnlock,
  onToggleLockOnExit,
}: AppearanceSettingsPageProps) {
  return (
    <section className="home-v2-settings-page">
      <header className="home-v2-page-heading">
        <h1>Settings</h1>
      </header>

      <section
        className="home-v2-settings-panel"
        aria-labelledby="appearance-title"
      >
        <div className="home-v2-settings-panel__heading">
          <h2 id="appearance-title">Appearance</h2>
          <p>Display settings apply to Home and supported QDN apps.</p>
        </div>

        <SettingRow
          label="Theme"
          description={
            appearance.theme === 'system'
              ? `Following system (${appearance.resolvedTheme}).`
              : `Using ${appearance.resolvedTheme} mode.`
          }
        >
          <select
            aria-label="Theme"
            value={appearance.theme}
            onChange={(event) =>
              onSetTheme?.(event.target.value as HomeV2ThemePreference)
            }
          >
            {homeV2ThemeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow
          label="Accent"
          description="Used for focus, selection, and primary actions."
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
              aria-label="Accent"
              value={appearance.accent}
              onChange={(event) =>
                onSetAccent?.(event.target.value as HomeV2Accent)
              }
            >
              {homeV2AccentOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </SettingRow>

        <SettingRow
          label="Text size"
          description="Changes interface and compatible app text."
        >
          <select
            aria-label="Text size"
            value={appearance.textSize}
            onChange={(event) =>
              onSetTextSize?.(event.target.value as HomeV2TextSize)
            }
          >
            {homeV2TextSizeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow
          label="Page zoom"
          description="Scales the complete browser and app surface."
        >
          <div className="home-v2-zoom-control" aria-label="Page zoom">
            <button
              type="button"
              aria-label="Zoom out"
              disabled={appearance.appZoom <= 50}
              onClick={() =>
                onSetAppZoom?.(Math.max(50, appearance.appZoom - 10))
              }
            >
              −
            </button>
            <output>{appearance.appZoom}%</output>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={appearance.appZoom >= 200}
              onClick={() =>
                onSetAppZoom?.(Math.min(200, appearance.appZoom + 10))
              }
            >
              +
            </button>
            <button
              type="button"
              className="home-v2-zoom-reset"
              disabled={appearance.appZoom === 100}
              onClick={() => onSetAppZoom?.(100)}
            >
              Reset
            </button>
          </div>
        </SettingRow>

        <SettingRow
          label="Language"
          description="Uses the device language when set to System."
        >
          <select
            aria-label="Language"
            value={appearance.language}
            onChange={(event) =>
              onSetLanguage?.(event.target.value as HomeV2Language)
            }
          >
            {homeV2LanguageOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingRow>
      </section>

      {account.state !== 'none' ? (
        <section
          className="home-v2-settings-panel"
          aria-labelledby="account-security-title"
        >
          <div className="home-v2-settings-panel__heading">
            <h2 id="account-security-title">Account security</h2>
            <p>Control how the selected account locks on this device.</p>
          </div>

          <SettingRow
            label="Remember unlock"
            description={
              account.secureStorageAvailable
                ? 'Use secure device storage instead of asking on every start.'
                : 'Secure device storage is unavailable.'
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
              <span>{account.rememberUnlock ? 'Enabled' : 'Disabled'}</span>
            </label>
          </SettingRow>

          <SettingRow
            label="Lock on exit"
            description="Require an unlock after Home closes. Enabled by default."
          >
            <label className="home-v2-toggle-control">
              <input
                type="checkbox"
                checked={account.lockOnExit}
                readOnly={!onToggleLockOnExit}
                onChange={onToggleLockOnExit}
              />
              <span>{account.lockOnExit ? 'Enabled' : 'Disabled'}</span>
            </label>
          </SettingRow>
        </section>
      ) : null}
    </section>
  )
}
