import {
  ACCENT_OPTIONS,
  getLanguageLabel,
  getThemeLabel,
  getTextSizeLabel,
  isLanguageSetting,
  LANGUAGE_OPTIONS,
  THEME_OPTIONS,
  TEXT_SIZE_OPTIONS,
  type AccentSetting,
  type DisplaySettings,
  type LanguageSetting,
  type TextSizeSetting,
  type ThemeSetting,
} from './displaySettings';
import { t } from './i18n';
import { isMacOs, isNativePlatform } from './platform';
import { SettingsSection } from './SettingsSection';

type DisplaySettingsPanelProps = {
  displaySettings: DisplaySettings;
  isExpanded: boolean;
  onExpandedChange: (isExpanded: boolean) => void;
  onLanguageChange: (language: LanguageSetting) => void;
  onThemeChange: (theme: ThemeSetting) => void;
  onTextSizeChange: (textSize: TextSizeSetting) => void;
  onAccentChange: (accent: AccentSetting) => void;
};

export function DisplaySettingsPanel({
  displaySettings,
  isExpanded,
  onExpandedChange,
  onLanguageChange,
  onThemeChange,
  onTextSizeChange,
  onAccentChange,
}: DisplaySettingsPanelProps) {
  const summary = t('display.summary', {
    theme: getThemeLabel(displaySettings.theme),
    language: getLanguageLabel(displaySettings.language),
    textSize: getTextSizeLabel(displaySettings.textSize),
  });
  const accentSwatch = ACCENT_OPTIONS.find((option) => option.value === displaySettings.accent)?.swatch;
  const accentLabel = t('display.accentLabel');
  // Desktop-only keyboard hint; hidden on Android (no hardware keyboard). The
  // modifier matches the renderer/Electron shortcut: ⌘⇧ on macOS, Ctrl+Shift elsewhere.
  const textSizeShortcutHint = isNativePlatform()
    ? null
    : t('display.textSizeShortcutHint', { modifier: isMacOs() ? '⌘⇧' : 'Ctrl+Shift' });

  return (
    <SettingsSection
      isExpanded={isExpanded}
      summary={
        <>
          {summary}
          <span
            aria-hidden="true"
            className="settings-section__summary-swatch"
            style={{ backgroundColor: accentSwatch ?? 'var(--color-accent)' }}
          />
        </>
      }
      title={t('display.sectionTitle')}
      onExpandedChange={onExpandedChange}
    >
      <div className="display-settings">
        <div className="display-settings__field">
          <span className="field__label">{t('display.themeLabel')}</span>
          <div className="segmented-control" role="radiogroup" aria-label={t('display.themeLabel')}>
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                aria-checked={displaySettings.theme === option.value}
                className={`segmented-control__option${
                  displaySettings.theme === option.value ? ' segmented-control__option--selected' : ''
                }`}
                role="radio"
                type="button"
                onClick={() => onThemeChange(option.value)}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <div className="display-settings__field">
          <span className="field__label">{accentLabel}</span>
          <div className="segmented-control segmented-control--accent" role="radiogroup" aria-label={accentLabel}>
            {ACCENT_OPTIONS.map((option) => (
              <button
                key={option.value}
                aria-label={t(option.labelKey)}
                aria-checked={displaySettings.accent === option.value}
                className={`segmented-control__option segmented-control__option--accent${
                  displaySettings.accent === option.value ? ' segmented-control__option--selected' : ''
                }`}
                role="radio"
                type="button"
                onClick={() => onAccentChange(option.value)}
              >
                <span aria-hidden="true" className="display-settings__accent-swatch" style={{ backgroundColor: option.swatch }} />
                <span className="sr-only">{t(option.labelKey)}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="display-settings__field field">
          <span className="field__label">{t('display.languageLabel')}</span>
          <select
            className="select"
            value={displaySettings.language}
            onChange={(event) => {
              if (isLanguageSetting(event.target.value)) {
                onLanguageChange(event.target.value);
              }
            }}
          >
            <option value="system">{t('display.languageSystem')}</option>
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="display-settings__field">
          <span className="field__label">
            {t('display.textSizeLabel')}
            {textSizeShortcutHint ? (
              <span className="field__label-hint">{textSizeShortcutHint}</span>
            ) : null}
          </span>
          <div className="segmented-control" role="radiogroup" aria-label={t('display.textSizeLabel')}>
            {TEXT_SIZE_OPTIONS.map((option) => (
              <button
                key={option.value}
                aria-checked={displaySettings.textSize === option.value}
                className={`segmented-control__option${
                  displaySettings.textSize === option.value ? ' segmented-control__option--selected' : ''
                }`}
                role="radio"
                type="button"
                onClick={() => onTextSizeChange(option.value)}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
