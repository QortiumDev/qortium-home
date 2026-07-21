import { AppUpdatePanel } from './AppUpdatePanel';
import { AppNotificationsSettingsPanel } from './AppNotificationsSettingsPanel';
import { QdnManagerPermissionsPanel } from './QdnManagerPermissionsPanel';
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
  UiSetting,
} from './displaySettings';
import { t } from './i18n';
import { NodeConnectionSettings } from './NodeConnection';
import type { OnChainCoreUpdateController } from './onChainCoreUpdateState';
import { PreferredAppsSettingsPanel } from './PreferredAppsSettingsPanel';
import type { PreferredApps } from './preferredApps';
import { SettingsSection } from './SettingsSection';

export type SettingsSectionId = 'core' | 'dataPermissions' | 'display' | 'home' | 'node' | 'notifications' | 'preferredApps';

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
  onAppNotificationsChange: (appNotifications: boolean) => void;
  onAppZoomChange: (appZoom: number) => void;
  onBookmarksManagerChange: (bookmarksManager: string) => void;
  onSectionExpansionChange: (sectionId: SettingsSectionId, isExpanded: boolean) => void;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onOpenReleaseNotes: (product: 'core' | 'home', tagName: string) => void;
  onSaveNodeSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
  onThemeChange: (theme: ThemeSetting) => void;
  onTextSizeChange: (textSize: TextSizeSetting) => void;
  onUiChange: (ui: UiSetting) => void;
  preferredApps: PreferredApps;
};

export function SettingsPage({
  appUpdates,
  connectionRefreshEpoch,
  coreManager,
  displaySettings,
  nodeSettings,
  onChainCoreUpdate,
  onLanguageChange,
  onAppNotificationsChange,
  onAppZoomChange,
  onBookmarksManagerChange,
  onOpenReleaseNotes,
  onResolvedNodeApiUrl,
  onSectionExpansionChange,
  onSaveNodeSettings,
  onAccentChange,
  onThemeChange,
  onTextSizeChange,
  onUiChange,
  preferredApps,
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
          onAppNotificationsChange={onAppNotificationsChange}
          onAppZoomChange={onAppZoomChange}
          onThemeChange={onThemeChange}
          onTextSizeChange={onTextSizeChange}
          onUiChange={onUiChange}
        />
        <AppNotificationsSettingsPanel
          isExpanded={sectionExpansion.notifications}
          onExpandedChange={(isExpanded) => onSectionExpansionChange('notifications', isExpanded)}
        />
        <QdnManagerPermissionsPanel
          isExpanded={sectionExpansion.dataPermissions}
          onExpandedChange={(isExpanded) => onSectionExpansionChange('dataPermissions', isExpanded)}
        />
        <PreferredAppsSettingsPanel
          isExpanded={sectionExpansion.preferredApps}
          preferredApps={preferredApps}
          onBookmarksManagerChange={onBookmarksManagerChange}
          onExpandedChange={(isExpanded) => onSectionExpansionChange('preferredApps', isExpanded)}
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
          onOpenReleaseNotes={onOpenReleaseNotes}
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
          onOpenReleaseNotes={onOpenReleaseNotes}
        />
      </div>
    </div>
  );
}
