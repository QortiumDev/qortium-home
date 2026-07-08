import { Minus, Plus } from 'lucide-react';
import {
  ACCENT_OPTIONS,
  DEFAULT_APP_ZOOM,
  getLanguageLabel,
  getThemeLabel,
  getTextSizeLabel,
  isLanguageSetting,
  LANGUAGE_OPTIONS,
  stepAppZoom,
  THEME_OPTIONS,
  TEXT_SIZE_OPTIONS,
  UI_OPTIONS,
  type AccentSetting,
  type DisplaySettings,
  type LanguageSetting,
  type TextSizeSetting,
  type ThemeSetting,
  type UiSetting,
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
  onAppZoomChange: (appZoom: number) => void;
  onAccentChange: (accent: AccentSetting) => void;
  onUiChange: (ui: UiSetting) => void;
};

export function DisplaySettingsPanel({
  displaySettings,
  isExpanded,
  onExpandedChange,
  onLanguageChange,
  onThemeChange,
  onTextSizeChange,
  onAppZoomChange,
  onAccentChange,
  onUiChange,
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
  const appZoomShortcutHint = isNativePlatform()
    ? null
    : t('display.appZoomShortcutHint', { modifier: isMacOs() ? '⌘' : 'Ctrl' });
  const useDesktopZoomStep = !!window.qortiumHome.zoom;
  const nextAppZoom = stepAppZoom(displaySettings.appZoom, 'in', useDesktopZoomStep);
  const previousAppZoom = stepAppZoom(displaySettings.appZoom, 'out', useDesktopZoomStep);

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
          <span className="field__label">{t('display.uiLabel')}</span>
          <div className="segmented-control" role="radiogroup" aria-label={t('display.uiLabel')}>
            {UI_OPTIONS.map((option) => (
              <button
                key={option.value}
                aria-checked={displaySettings.ui === option.value}
                className={`segmented-control__option${
                  displaySettings.ui === option.value ? ' segmented-control__option--selected' : ''
                }`}
                role="radio"
                type="button"
                onClick={() => onUiChange(option.value)}
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
        <div className="display-settings__field">
          <span className="field__label">
            {t('display.appZoomLabel')}
            {appZoomShortcutHint ? (
              <span className="field__label-hint">{appZoomShortcutHint}</span>
            ) : null}
          </span>
          <div className="display-settings__app-zoom-control">
            <button
              aria-label={t('display.appZoomOut')}
              className="icon-button"
              disabled={previousAppZoom === displaySettings.appZoom}
              type="button"
              onClick={() => onAppZoomChange(previousAppZoom)}
            >
              <Minus aria-hidden="true" size={16} strokeWidth={2} />
            </button>
            <span className="display-settings__app-zoom-level">
              {t('display.appZoomLevel', { percent: String(displaySettings.appZoom) })}
            </span>
            <button
              aria-label={t('display.appZoomIn')}
              className="icon-button"
              disabled={nextAppZoom === displaySettings.appZoom}
              type="button"
              onClick={() => onAppZoomChange(nextAppZoom)}
            >
              <Plus aria-hidden="true" size={16} strokeWidth={2} />
            </button>
            {displaySettings.appZoom !== DEFAULT_APP_ZOOM ? (
              <button
                className="button button--secondary display-settings__app-zoom-reset"
                type="button"
                onClick={() => onAppZoomChange(DEFAULT_APP_ZOOM)}
              >
                {t('display.appZoomReset')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
