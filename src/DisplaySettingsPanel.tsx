import {
  getLanguageLabel,
  getThemeLabel,
  getTextSizeLabel,
  LANGUAGE_OPTIONS,
  THEME_OPTIONS,
  TEXT_SIZE_OPTIONS,
  type DisplaySettings,
  type LanguageSetting,
  type TextSizeSetting,
  type ThemeSetting,
} from './displaySettings';
import { SettingsSection } from './SettingsSection';
import { SETTINGS_TEXT } from './settingsText';

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
  const summary = `${getThemeLabel(displaySettings.theme)}, ${getLanguageLabel(displaySettings.language)}, ${getTextSizeLabel(
    displaySettings.textSize,
  )}`;

  return (
    <SettingsSection
      isExpanded={isExpanded}
      summary={summary}
      title={SETTINGS_TEXT.sections.displaySettings}
      onExpandedChange={onExpandedChange}
    >
      <div className="display-settings">
        <div className="display-settings__field">
          <span className="field__label">{SETTINGS_TEXT.labels.theme}</span>
          <div className="segmented-control" role="radiogroup" aria-label={SETTINGS_TEXT.labels.theme}>
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
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="display-settings__field">
          <span className="field__label">{SETTINGS_TEXT.labels.language}</span>
          <div
            className="segmented-control segmented-control--single"
            role="radiogroup"
            aria-label={SETTINGS_TEXT.labels.language}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                aria-checked={displaySettings.language === option.value}
                className={`segmented-control__option${
                  displaySettings.language === option.value ? ' segmented-control__option--selected' : ''
                }`}
                role="radio"
                type="button"
                onClick={() => onLanguageChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="display-settings__field">
          <span className="field__label">{SETTINGS_TEXT.labels.textSize}</span>
          <div className="segmented-control" role="radiogroup" aria-label={SETTINGS_TEXT.labels.textSize}>
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
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
