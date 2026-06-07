import {
  getTextSizeLabel,
  TEXT_SIZE_OPTIONS,
  type TextSizeSetting,
} from './displaySettings';
import { SettingsSection } from './SettingsSection';
import { SETTINGS_TEXT } from './settingsText';

type DisplaySettingsPanelProps = {
  isExpanded: boolean;
  onExpandedChange: (isExpanded: boolean) => void;
  onTextSizeChange: (textSize: TextSizeSetting) => void;
  textSize: TextSizeSetting;
};

export function DisplaySettingsPanel({
  isExpanded,
  onExpandedChange,
  onTextSizeChange,
  textSize,
}: DisplaySettingsPanelProps) {
  return (
    <SettingsSection
      isExpanded={isExpanded}
      summary={getTextSizeLabel(textSize)}
      title={SETTINGS_TEXT.sections.displaySettings}
      onExpandedChange={onExpandedChange}
    >
      <div className="display-settings">
        <div className="display-settings__field">
          <span className="field__label">{SETTINGS_TEXT.labels.textSize}</span>
          <div className="segmented-control" role="radiogroup" aria-label={SETTINGS_TEXT.labels.textSize}>
            {TEXT_SIZE_OPTIONS.map((option) => (
              <button
                key={option.value}
                aria-checked={textSize === option.value}
                className={`segmented-control__option${
                  textSize === option.value ? ' segmented-control__option--selected' : ''
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
