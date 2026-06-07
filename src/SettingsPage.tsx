import { AppUpdatePanel } from './AppUpdatePanel';
import type { AppUpdatesState } from './appUpdateState';
import { CoreManagerPanel } from './CoreManagerPanel';
import type { CoreManagerState } from './coreManagerState';
import { DisplaySettingsPanel } from './DisplaySettingsPanel';
import type { TextSizeSetting } from './displaySettings';
import { NodeSettingsPanel } from './NodeSettingsPanel';
import type { OnChainCoreUpdateController } from './onChainCoreUpdateState';

export type SettingsSectionId = 'core' | 'display' | 'home' | 'node';

export type SettingsExpansionState = Record<SettingsSectionId, boolean>;

type SettingsPageProps = {
  appUpdates: AppUpdatesState;
  coreManager: CoreManagerState;
  onChainCoreUpdate: OnChainCoreUpdateController;
  sectionExpansion: SettingsExpansionState;
  nodeSettings: QortiumNodeSettings;
  onSectionExpansionChange: (sectionId: SettingsSectionId, isExpanded: boolean) => void;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSaveNodeSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
  onTextSizeChange: (textSize: TextSizeSetting) => void;
  textSize: TextSizeSetting;
};

export function SettingsPage({
  appUpdates,
  coreManager,
  nodeSettings,
  onChainCoreUpdate,
  onResolvedNodeApiUrl,
  onSectionExpansionChange,
  onSaveNodeSettings,
  onTextSizeChange,
  sectionExpansion,
  textSize,
}: SettingsPageProps) {
  return (
    <div className="settings-page">
      <header className="settings-page__header">
        <h1>Settings</h1>
      </header>

      <div className="settings-page__sections">
        <DisplaySettingsPanel
          isExpanded={sectionExpansion.display}
          textSize={textSize}
          onExpandedChange={(isExpanded) => onSectionExpansionChange('display', isExpanded)}
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
