import { AppUpdatePanel } from './AppUpdatePanel';
import { CoreManagerPanel } from './CoreManagerPanel';
import { NodeSettingsPanel } from './NodeSettingsPanel';

type SettingsPageProps = {
  nodeSettings: QortiumNodeSettings;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSaveNodeSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
};

export function SettingsPage({
  nodeSettings,
  onResolvedNodeApiUrl,
  onSaveNodeSettings,
}: SettingsPageProps) {
  return (
    <div className="settings-page">
      <header className="settings-page__header">
        <h1>Settings</h1>
      </header>

      <div className="settings-page__sections">
        <NodeSettingsPanel
          nodeSettings={nodeSettings}
          onResolvedNodeApiUrl={onResolvedNodeApiUrl}
          onSaveNodeSettings={onSaveNodeSettings}
        />
        <CoreManagerPanel
          nodeSettings={nodeSettings}
          onResolvedNodeApiUrl={onResolvedNodeApiUrl}
          onSaveNodeSettings={onSaveNodeSettings}
        />
        <AppUpdatePanel />
      </div>
    </div>
  );
}
