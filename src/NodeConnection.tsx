import { useEffect, useState } from 'react';
import { t } from './i18n';

// Shared node-connection controls. The mode dropdown auto-applies (test + save)
// the moment it changes — there is no separate Test/Save button. A failed apply
// surfaces the usual disconnected state (and, in the full settings variant, an
// inline error). Two surfaces use this:
//   - NodeModeSelect: the compact dropdown on the Dashboard Core tile.
//   - NodeConnectionSettings: the dropdown + custom URL / API key fields shown in
//     the Settings → Qortium Core section (the only place a custom node is set up).

type SaveNodeSettings = (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;

function formatError(error: unknown) {
  if (!(error instanceof Error)) {
    return t('node.updateSettingsFailed');
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

// Apply a node-settings change: persist it, then point the rest of the app at the
// resolved node URL. Shared by both surfaces so they stay in lockstep.
async function applyNodeSettings(
  request: QortiumNodeSettingsRequest,
  onSaveNodeSettings: SaveNodeSettings,
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void,
): Promise<QortiumNodeSettings> {
  const settings = await onSaveNodeSettings(request);
  onResolvedNodeApiUrl(settings.nodeApiUrl);

  return settings;
}

function ModeOptions({ nodeSettings }: { nodeSettings: QortiumNodeSettings }) {
  return (
    <>
      <option value="local">{t('node.mode.local')}</option>
      {nodeSettings.networkModeAvailable ? <option value="network">{t('node.mode.network')}</option> : null}
      <option value="custom">{t('node.mode.custom')}</option>
    </>
  );
}

// Compact, controlled dropdown for the Dashboard Core tile. Bound to the saved
// mode, so a failed apply (e.g. switching to a custom node that isn't configured)
// reverts on its own; the custom URL is configured in Settings.
export function NodeModeSelect({
  className,
  nodeSettings,
  onResolvedNodeApiUrl,
  onSaveNodeSettings,
}: {
  className?: string;
  nodeSettings: QortiumNodeSettings;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSaveNodeSettings: SaveNodeSettings;
}) {
  const [isSaving, setIsSaving] = useState(false);

  async function handleChange(mode: QortiumNodeSettingsMode) {
    setIsSaving(true);
    try {
      await applyNodeSettings(
        {
          mode,
          customUrl: nodeSettings.customUrl.trim() || undefined,
          apiKey: mode === 'network' ? undefined : nodeSettings.apiKey.trim() || undefined,
        },
        onSaveNodeSettings,
        onResolvedNodeApiUrl,
      );
    } catch {
      // Bound to nodeSettings.mode, so the select reverts itself; the disconnected
      // state is shown by the usual node-status surfaces.
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <select
      aria-label={t('node.nodeLabel')}
      className={className ?? 'field__input'}
      disabled={isSaving}
      value={nodeSettings.mode}
      onChange={(event) => void handleChange(event.target.value as QortiumNodeSettingsMode)}
    >
      <ModeOptions nodeSettings={nodeSettings} />
    </select>
  );
}

function getApiKeyHint(mode: QortiumNodeSettingsMode) {
  return mode === 'custom' ? t('node.apiKeyHintCustom') : t('node.apiKeyHintLocal');
}

// Full controls for the Settings → Qortium Core section. Keeps a local working
// copy so 'custom' can reveal its URL/API key fields before anything is saved.
// The mode dropdown applies immediately; the text fields apply on blur (or Enter),
// so there is still no explicit Save button.
export function NodeConnectionSettings({
  initialMode,
  nodeSettings,
  onResolvedNodeApiUrl,
  onSaveNodeSettings,
}: {
  // Welcome can reveal a custom-node form before a custom URL exists, while the
  // Settings surface continues to mirror the saved mode exactly.
  initialMode?: QortiumNodeSettingsMode;
  nodeSettings: QortiumNodeSettings;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSaveNodeSettings: SaveNodeSettings;
}) {
  const [mode, setMode] = useState<QortiumNodeSettingsMode>(initialMode ?? nodeSettings.mode);
  const [customUrl, setCustomUrl] = useState(nodeSettings.customUrl);
  const [apiKey, setApiKey] = useState(nodeSettings.apiKey);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const showApiKeyField = mode !== 'network';

  useEffect(() => {
    setMode(initialMode ?? nodeSettings.mode);
    setCustomUrl(nodeSettings.customUrl);
    setApiKey(nodeSettings.apiKey);
  }, [initialMode, nodeSettings]);

  async function save(nextMode: QortiumNodeSettingsMode, nextCustomUrl: string, nextApiKey: string) {
    setIsSaving(true);
    setError(null);
    try {
      await applyNodeSettings(
        {
          mode: nextMode,
          customUrl: nextCustomUrl.trim() || undefined,
          apiKey: nextMode === 'network' ? undefined : nextApiKey.trim() || undefined,
        },
        onSaveNodeSettings,
        onResolvedNodeApiUrl,
      );
    } catch (caught) {
      setError(formatError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  function handleModeChange(nextMode: QortiumNodeSettingsMode) {
    setMode(nextMode);
    setError(null);
    if (nextMode === 'network') {
      setApiKey('');
    }
    // Switching to custom only saves once a URL exists; otherwise we just reveal
    // the URL field and wait for the user to fill it in (saved on blur).
    if (nextMode !== 'custom' || customUrl.trim()) {
      void save(nextMode, customUrl, nextMode === 'network' ? '' : apiKey);
    }
  }

  return (
    <div className="node-connection">
      <label className="field">
        <span className="field__label">{t('node.nodeLabel')}</span>
        <select
          className="field__input"
          disabled={isSaving}
          value={mode}
          onChange={(event) => handleModeChange(event.target.value as QortiumNodeSettingsMode)}
        >
          <ModeOptions nodeSettings={nodeSettings} />
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
              setError(null);
            }}
            onBlur={() => {
              if (customUrl.trim()) {
                void save('custom', customUrl, apiKey);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
          />
        </label>
      ) : mode === 'network' ? (
        <p className="node-connection__preset">
          <span>{t('common.endpoint')}</span>
          <span>{t('node.networkSummary', { count: nodeSettings.networkSeedUrls.length.toLocaleString() })}</span>
        </p>
      ) : null}

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
              setError(null);
            }}
            onBlur={() => {
              if (mode !== 'custom' || customUrl.trim()) {
                void save(mode, customUrl, apiKey);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
          />
          <span className="field__hint">{getApiKeyHint(mode)}</span>
        </label>
      ) : null}

      {error ? <p className="node-connection__message node-connection__message--error">{error}</p> : null}
    </div>
  );
}
