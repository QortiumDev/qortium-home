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
        <label className="display-settings__field field">
          <span className="field__label">{SETTINGS_TEXT.labels.language}</span>
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
          <span className="field__hint">{SETTINGS_TEXT.hints.language}</span>
        </label>
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
