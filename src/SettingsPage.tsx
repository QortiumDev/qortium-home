import { AppUpdatePanel } from './AppUpdatePanel';
import type { AppUpdatesState } from './appUpdateState';
import { CoreManagerPanel } from './CoreManagerPanel';
import type { CoreManagerState } from './coreManagerState';
import { DisplaySettingsPanel } from './DisplaySettingsPanel';
import type {
  AccentSetting,
  DisplaySettings,
  LanguageSetting,
  TextSizeSetting,
  ThemeSetting,
} from './displaySettings';
import { t } from './i18n';
import { NodeConnectionSettings } from './NodeConnection';
import type { OnChainCoreUpdateController } from './onChainCoreUpdateState';
import { SettingsSection } from './SettingsSection';

export type SettingsSectionId = 'core' | 'display' | 'home' | 'node';

export type SettingsExpansionState = Record<SettingsSectionId, boolean>;

type SettingsPageProps = {
  appUpdates: AppUpdatesState;
  connectionRefreshEpoch: number;
  coreManager: CoreManagerState;
  displaySettings: DisplaySettings;
  onChainCoreUpdate: OnChainCoreUpdateController;
  sectionExpansion: SettingsExpansionState;
  nodeSettings: QortiumNodeSettings;
  onLanguageChange: (language: LanguageSetting) => void;
  onAccentChange: (accent: AccentSetting) => void;
  onSectionExpansionChange: (sectionId: SettingsSectionId, isExpanded: boolean) => void;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSaveNodeSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
  onThemeChange: (theme: ThemeSetting) => void;
  onTextSizeChange: (textSize: TextSizeSetting) => void;
};

export function SettingsPage({
  appUpdates,
  connectionRefreshEpoch,
  coreManager,
  displaySettings,
  nodeSettings,
  onChainCoreUpdate,
  onLanguageChange,
  onResolvedNodeApiUrl,
  onSectionExpansionChange,
  onSaveNodeSettings,
  onAccentChange,
  onThemeChange,
  onTextSizeChange,
  sectionExpansion,
}: SettingsPageProps) {
  // On desktop the node-connection controls live inside the Qortium Core section.
  // Android/web have no managed Core (so that section is hidden), so they keep a
  // dedicated node section — otherwise there would be nowhere to choose the node.
  const hasManagedCore = !!window.qortiumHome.core;

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
          onAccentChange={onAccentChange}
          onThemeChange={onThemeChange}
          onTextSizeChange={onTextSizeChange}
        />
        {hasManagedCore ? null : (
          <SettingsSection
            defaultExpanded
            isExpanded={sectionExpansion.node}
            summary={nodeSettings.mode === 'network' ? t('node.mode.network') : nodeSettings.nodeApiUrl}
            title={t('node.sectionTitle')}
            onExpandedChange={(isExpanded) => onSectionExpansionChange('node', isExpanded)}
          >
            <NodeConnectionSettings
              nodeSettings={nodeSettings}
              onResolvedNodeApiUrl={onResolvedNodeApiUrl}
              onSaveNodeSettings={onSaveNodeSettings}
            />
          </SettingsSection>
        )}
        <CoreManagerPanel
          connectionRefreshEpoch={connectionRefreshEpoch}
          coreManager={coreManager}
          isExpanded={sectionExpansion.core}
          nodeSettings={nodeSettings}
          onChainCoreUpdate={onChainCoreUpdate}
          onExpandedChange={(isExpanded) => onSectionExpansionChange('core', isExpanded)}
          onResolvedNodeApiUrl={onResolvedNodeApiUrl}
          onSaveNodeSettings={onSaveNodeSettings}
        />
        <AppUpdatePanel
          connectionRefreshEpoch={connectionRefreshEpoch}
          isExpanded={sectionExpansion.home}
          isManagedNode={nodeSettings.mode === 'local'}
          nodeApiUrl={nodeSettings.nodeApiUrl}
          updates={appUpdates}
          onExpandedChange={(isExpanded) => onSectionExpansionChange('home', isExpanded)}
        />
      </div>
    </div>
  );
}
