import { Check, RefreshCw } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { t } from './i18n';
import { isNativePlatform } from './platform';
import { SettingsSection } from './SettingsSection';

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
    return t('node.updateSettingsFailed');
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
    return t('node.mode.custom');
  }

  if (mode === 'network') {
    return t('node.mode.network');
  }

  return t('node.mode.local');
}

function getNodeSettingsSummary(nodeSettings: QortiumNodeSettings) {
  if (nodeSettings.mode === 'network') {
    return formatMode(nodeSettings.mode);
  }

  return nodeSettings.nodeApiUrl;
}

function getApiKeyHint(mode: QortiumNodeSettingsMode) {
  if (mode === 'custom') {
    return t('node.apiKeyHintCustom');
  }

  return t('node.apiKeyHintLocal');
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
        text: result.ok ? t('node.connected', { nodeApiUrl: result.nodeApiUrl }) : result.message,
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
        text: t('node.usingNode', { nodeApiUrl: settings.nodeApiUrl }),
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
      title={t('node.sectionTitle')}
      onExpandedChange={onExpandedChange}
    >
      <div className="node-settings">
      <form className="node-settings__form" onSubmit={handleSave}>
        <label className="field">
          <span className="field__label">{t('node.nodeLabel')}</span>
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
            <option value="local">{t('node.mode.local')}</option>
            {nodeSettings.networkModeAvailable ? (
              <option value="network">{t('node.mode.network')}</option>
            ) : null}
            <option value="custom">{t('node.mode.custom')}</option>
          </select>
        </label>

        {mode === 'custom' ? (
          <label className="field">
            <span className="field__label">{t('node.customUrl')}</span>
            <input
              className="field__input"
              placeholder={t('node.customUrlPlaceholder')}
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
            <span>{t('common.endpoint')}</span>
            <span>
              {t('node.networkSummary', { count: nodeSettings.networkSeedUrls.length.toLocaleString() })}
            </span>
          </p>
        ) : (
          <p className="node-settings__preset">
            <span>{t('common.endpoint')}</span>
            <span>{nodeSettings.localUrl}</span>
          </p>
        )}

        {showApiKeyField ? (
          <label className="field">
            <span className="field__label">{t('node.apiKey')}</span>
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
            {isTesting ? t('node.testing') : t('node.test')}
          </button>
          <button className="button" disabled={isSaving || isTesting} type="submit">
            <Check aria-hidden="true" size={18} strokeWidth={2} />
            {isSaving ? t('common.saving') : t('common.save')}
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
