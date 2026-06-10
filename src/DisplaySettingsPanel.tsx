import {
  getLanguageLabel,
  getThemeLabel,
  getTextSizeLabel,
  isLanguageSetting,
  LANGUAGE_OPTIONS,
  THEME_OPTIONS,
  TEXT_SIZE_OPTIONS,
  type DisplaySettings,
  type LanguageSetting,
  type TextSizeSetting,
  type ThemeSetting,
} from './displaySettings';
import { t } from './i18n';
import { SettingsSection } from './SettingsSection';

type DisplaySettingsPanelProps = {
  displaySettings: DisplaySettings;
  isExpanded: boolean;
  onExpandedChange: (isExpanded: boolean) => void;
  onLanguageChange: (language: LanguageSetting) => void;
  onThemeChange: (theme: ThemeSetting) => void;
  onTextSizeChange: (textSize: TextSizeSetting) => void;
};

export function DisplaySettingsPanel({
  displaySettings,
  isExpanded,
  onExpandedChange,
  onLanguageChange,
  onThemeChange,
  onTextSizeChange,
}: DisplaySettingsPanelProps) {
  const summary = t('display.summary', {
    theme: getThemeLabel(displaySettings.theme),
    language: getLanguageLabel(displaySettings.language),
    textSize: getTextSizeLabel(displaySettings.textSize),
  });

  return (
    <SettingsSection
      isExpanded={isExpanded}
      summary={summary}
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
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="display-settings__field">
          <span className="field__label">{t('display.textSizeLabel')}</span>
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
