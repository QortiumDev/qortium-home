import { Check, RefreshCw } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { isNativePlatform } from './platform';

type ConfigMessage = {
  kind: 'error' | 'success';
  text: string;
} | null;

type NodeSettingsPanelProps = {
  nodeSettings: QortiumNodeSettings;
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

function getApiKeyHint(mode: QortiumNodeSettingsMode) {
  if (mode === 'custom') {
    return 'Used for protected admin calls on this custom node.';
  }

  return 'Home detects this from managed Core when available.';
}

export function NodeSettingsPanel({
  nodeSettings,
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
    <section className="node-settings" aria-label="Node settings">
      <div className="node-settings__header">
        <h2 className="node-settings__title">Node Settings</h2>
      </div>

      <dl className="detail-list node-settings__details">
        <div className="detail-list__row">
          <dt className="detail-list__label">Current node</dt>
          <dd className="detail-list__value">{nodeSettings.nodeApiUrl}</dd>
        </div>
        <div className="detail-list__row">
          <dt className="detail-list__label">Mode</dt>
          <dd className="detail-list__value">{formatMode(nodeSettings.mode)}</dd>
        </div>
      </dl>

      <form className="node-settings__form" onSubmit={handleSave}>
        <label className="field">
          <span className="field__label">Node</span>
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
            <span>Network</span>
            <span>
              Public read-only browsing through {nodeSettings.networkSeedUrls.length.toLocaleString()} seeds
            </span>
          </p>
        ) : (
          <p className="node-settings__preset">
            <span>Local</span>
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
            {isTesting ? 'Testing' : 'Test'}
          </button>
          <button className="button" disabled={isSaving || isTesting} type="submit">
            <Check aria-hidden="true" size={18} strokeWidth={2} />
            {isSaving ? 'Saving' : 'Save'}
          </button>
        </div>

        {configMessage ? (
          <p className={`node-settings__message node-settings__message--${configMessage.kind}`}>
            {configMessage.text}
          </p>
        ) : null}
      </form>
    </section>
  );
}
