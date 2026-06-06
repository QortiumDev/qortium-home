import { Check, RefreshCw } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { isNativePlatform } from './platform';
import { SettingsSection } from './SettingsSection';
import { SETTINGS_TEXT } from './settingsText';

type ConfigMessage = {
  kind: 'error' | 'success';
  text: string;
} | null;

type NodeSettingsPanelProps = {
  isExpanded: boolean;
  nodeSettings: QortiumNodeSettings;
  onExpandedChange: (isExpanded: boolean) => void;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSaveNodeSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
};

function formatError(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Unable to update node settings.';
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function getNodeSettingsRequest(mode: QortiumNodeSettingsMode, customUrl: string, apiKey: string) {
  return {
    apiKey: apiKey.trim() || undefined,
    mode,
    customUrl: customUrl.trim() || undefined,
  };
}

function formatMode(mode: QortiumNodeSettingsMode) {
  if (mode === 'custom') {
    return 'Custom';
  }

  if (mode === 'network') {
    return 'Previewnet network';
  }

  return 'Local node';
}

function getNodeSettingsSummary(nodeSettings: QortiumNodeSettings) {
  if (nodeSettings.mode === 'network') {
    return formatMode(nodeSettings.mode);
  }

  return nodeSettings.nodeApiUrl;
}

function getApiKeyHint(mode: QortiumNodeSettingsMode) {
  if (mode === 'custom') {
    return 'Used for protected admin calls on this custom node.';
  }

  return 'Home detects this from the active local Core when available.';
}

export function NodeSettingsPanel({
  isExpanded,
  nodeSettings,
  onExpandedChange,
  onResolvedNodeApiUrl,
  onSaveNodeSettings,
}: NodeSettingsPanelProps) {
  const [mode, setMode] = useState<QortiumNodeSettingsMode>(nodeSettings.mode);
  const [customUrl, setCustomUrl] = useState(nodeSettings.customUrl);
  const [apiKey, setApiKey] = useState(nodeSettings.apiKey);
  const [configMessage, setConfigMessage] = useState<ConfigMessage>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const showApiKeyField = isNativePlatform() && mode !== 'network';

  useEffect(() => {
    setMode(nodeSettings.mode);
    setCustomUrl(nodeSettings.customUrl);
    setApiKey(nodeSettings.apiKey);
  }, [nodeSettings]);

  async function handleTestConnection() {
    setIsTesting(true);
    setConfigMessage(null);

    try {
      const result = await window.qortiumHome.node.testConnection(getNodeSettingsRequest(mode, customUrl, apiKey));

      if (result.ok) {
        onResolvedNodeApiUrl(result.nodeApiUrl);
      }

      setConfigMessage({
        kind: result.ok ? 'success' : 'error',
        text: result.ok ? `Connected to ${result.nodeApiUrl}.` : result.message,
      });
    } catch (error) {
      setConfigMessage({
        kind: 'error',
        text: formatError(error),
      });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setConfigMessage(null);

    try {
      const settings = await onSaveNodeSettings(getNodeSettingsRequest(mode, customUrl, apiKey));

      onResolvedNodeApiUrl(settings.nodeApiUrl);
      setConfigMessage({
        kind: 'success',
        text: `Using ${settings.nodeApiUrl}.`,
      });
    } catch (error) {
      setConfigMessage({
        kind: 'error',
        text: formatError(error),
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <SettingsSection
      defaultExpanded
      isExpanded={isExpanded}
      summary={getNodeSettingsSummary(nodeSettings)}
      title={SETTINGS_TEXT.sections.nodeSettings}
      onExpandedChange={onExpandedChange}
    >
      <div className="node-settings">
      <form className="node-settings__form" onSubmit={handleSave}>
        <label className="field">
          <span className="field__label">{SETTINGS_TEXT.labels.node}</span>
          <select
            className="field__input"
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as QortiumNodeSettingsMode);
              if (event.target.value === 'network') {
                setApiKey('');
              }
              setConfigMessage(null);
            }}
          >
            <option value="local">Local node</option>
            {nodeSettings.networkModeAvailable ? (
              <option value="network">Previewnet network</option>
            ) : null}
            <option value="custom">Custom</option>
          </select>
        </label>

        {mode === 'custom' ? (
          <label className="field">
            <span className="field__label">Custom URL</span>
            <input
              className="field__input"
              placeholder="http://127.0.0.1:24891"
              spellCheck={false}
              type="text"
              value={customUrl}
              onChange={(event) => {
                setCustomUrl(event.target.value);
                setConfigMessage(null);
              }}
            />
          </label>
        ) : mode === 'network' ? (
          <p className="node-settings__preset">
            <span>{SETTINGS_TEXT.labels.endpoint}</span>
            <span>
              Public read-only browsing through {nodeSettings.networkSeedUrls.length.toLocaleString()} seeds
            </span>
          </p>
        ) : (
          <p className="node-settings__preset">
            <span>{SETTINGS_TEXT.labels.endpoint}</span>
            <span>{nodeSettings.localUrl}</span>
          </p>
        )}

        {showApiKeyField ? (
          <label className="field">
            <span className="field__label">API key</span>
            <input
              autoComplete="off"
              className="field__input"
              spellCheck={false}
              type="password"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setConfigMessage(null);
              }}
            />
            <span className="field__hint">{getApiKeyHint(mode)}</span>
          </label>
        ) : null}

        <div className="node-settings__actions">
          <button
            className="button button--secondary"
            disabled={isSaving || isTesting}
            type="button"
            onClick={handleTestConnection}
          >
            <RefreshCw aria-hidden="true" size={18} strokeWidth={2} />
            {isTesting ? SETTINGS_TEXT.actions.testing : SETTINGS_TEXT.actions.test}
          </button>
          <button className="button" disabled={isSaving || isTesting} type="submit">
            <Check aria-hidden="true" size={18} strokeWidth={2} />
            {isSaving ? SETTINGS_TEXT.actions.saving : SETTINGS_TEXT.actions.save}
          </button>
        </div>

        {configMessage ? (
          <p className={`node-settings__message node-settings__message--${configMessage.kind}`}>
            {configMessage.text}
          </p>
        ) : null}
      </form>
      </div>
    </SettingsSection>
  );
}
