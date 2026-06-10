import { AppUpdatePanel } from './AppUpdatePanel';
import type { AppUpdatesState } from './appUpdateState';
import { CoreManagerPanel } from './CoreManagerPanel';
import type { CoreManagerState } from './coreManagerState';
import { DisplaySettingsPanel } from './DisplaySettingsPanel';
import type { DisplaySettings, LanguageSetting, TextSizeSetting, ThemeSetting } from './displaySettings';
import { t } from './i18n';
import { NodeSettingsPanel } from './NodeSettingsPanel';
import type { OnChainCoreUpdateController } from './onChainCoreUpdateState';

export type SettingsSectionId = 'core' | 'display' | 'home' | 'node';

export type SettingsExpansionState = Record<SettingsSectionId, boolean>;

type SettingsPageProps = {
  appUpdates: AppUpdatesState;
  coreManager: CoreManagerState;
  displaySettings: DisplaySettings;
  onChainCoreUpdate: OnChainCoreUpdateController;
  sectionExpansion: SettingsExpansionState;
  nodeSettings: QortiumNodeSettings;
  onLanguageChange: (language: LanguageSetting) => void;
  onSectionExpansionChange: (sectionId: SettingsSectionId, isExpanded: boolean) => void;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSaveNodeSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
  onThemeChange: (theme: ThemeSetting) => void;
  onTextSizeChange: (textSize: TextSizeSetting) => void;
};

export function SettingsPage({
  appUpdates,
  coreManager,
  displaySettings,
  nodeSettings,
  onChainCoreUpdate,
  onLanguageChange,
  onResolvedNodeApiUrl,
  onSectionExpansionChange,
  onSaveNodeSettings,
  onThemeChange,
  onTextSizeChange,
  sectionExpansion,
}: SettingsPageProps) {
  return (
    <div className="settings-page">
      <header className="settings-page__header">
        <h1>{t('common.settings')}</h1>
      </header>

      <div className="settings-page__sections">
        <DisplaySettingsPanel
          displaySettings={displaySettings}
          isExpanded={sectionExpansion.display}
          onExpandedChange={(isExpanded) => onSectionExpansionChange('display', isExpanded)}
          onLanguageChange={onLanguageChange}
          onThemeChange={onThemeChange}
          onTextSizeChange={onTextSizeChange}
        />
        <NodeSettingsPanel
          isExpanded={sectionExpansion.node}
          nodeSettings={nodeSettings}
          onExpandedChange={(isExpanded) => onSectionExpansionChange('node', isExpanded)}
          onResolvedNodeApiUrl={onResolvedNodeApiUrl}
          onSaveNodeSettings={onSaveNodeSettings}
        />
        <CoreManagerPanel
          coreManager={coreManager}
          isExpanded={sectionExpansion.core}
          onChainCoreUpdate={onChainCoreUpdate}
          onExpandedChange={(isExpanded) => onSectionExpansionChange('core', isExpanded)}
        />
        <AppUpdatePanel
          isExpanded={sectionExpansion.home}
          updates={appUpdates}
          onExpandedChange={(isExpanded) => onSectionExpansionChange('home', isExpanded)}
        />
      </div>
    </div>
  );
}
