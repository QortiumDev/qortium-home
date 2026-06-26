import { Power, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from './i18n';
import type { QdnDisplaySettings } from './qdn';

const DOCS_PATH = '/api-documentation/';
const DOCS_PROBE_MAX_BYTES = 262_144;
// The Core serves a static placeholder page (HTTP 200) at /api-documentation/
// when apiDocumentationEnabled is false, so the probe must inspect the body.
const DOCS_DISABLED_PATTERN = /currently disabled|api documentation disabled/i;
const RESTART_POLL_INTERVAL_MS = 3_000;
// Keep a generous timeout because enabling documentation requires a full Core
// restart, and older Core builds can take several minutes to relaunch.
const RESTART_POLL_TIMEOUT_MS = 600_000;

type CoreApiDocsPageProps = {
  displaySettings: QdnDisplaySettings;
  nodeSettings: QortiumNodeSettings;
};

type DocsState =
  | { frameSrc: string; phase: 'available' }
  | { phase: 'checking' }
  | { phase: 'disabled' }
  | { phase: 'enabling' }
  | { phase: 'restarting' }
  | { message: string; phase: 'error' };

function formatError(error: unknown) {
  if (!(error instanceof Error)) {
    return t('api.loadFailed');
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function delay(durationMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

type DocsProbeResult =
  | { kind: 'available' }
  | { kind: 'disabled' }
  | { kind: 'http-error'; status: number };

async function probeApiDocumentation(): Promise<DocsProbeResult> {
  const result = await window.qortiumHome.qdn.fetchNodeApi({
    maxBytes: DOCS_PROBE_MAX_BYTES,
    path: DOCS_PATH,
  });

  // Public read-only gateways block the path with 403; very old nodes 404 it.
  if (result.status === 403 || result.status === 404) {
    return { kind: 'disabled' };
  }

  if (result.status < 200 || result.status >= 300) {
    return { kind: 'http-error', status: result.status };
  }

  if (!result.tooLarge && DOCS_DISABLED_PATTERN.test(result.body)) {
    return { kind: 'disabled' };
  }

  return { kind: 'available' };
}

function buildCoreApiDocsFrameUrl(
  docsUrl: string,
  cacheBust: number,
  displaySettings: QdnDisplaySettings,
) {
  const url = new URL(docsUrl);

  url.searchParams.set('v', String(cacheBust));
  url.searchParams.set('theme', displaySettings.theme);
  url.searchParams.set('accent', displaySettings.accent);
  url.searchParams.set('textSize', displaySettings.textSize);

  return url.toString();
}

function getCoreApiDocsDisplaySettingMessages(displaySettings: QdnDisplaySettings) {
  return [
    {
      action: 'THEME_CHANGED',
      requestedHandler: 'UI',
      theme: displaySettings.theme,
    },
    {
      action: 'TEXT_SIZE_CHANGED',
      requestedHandler: 'UI',
      textSize: displaySettings.textSize,
    },
    {
      accent: displaySettings.accent,
      action: 'ACCENT_CHANGED',
      requestedHandler: 'UI',
    },
  ];
}

function getPostMessageTargetOrigin(url: string) {
  try {
    const origin = new URL(url).origin;

    return origin === 'null' ? '*' : origin;
  } catch {
    return '*';
  }
}

function postCoreApiDocsDisplaySettings(
  frameWindow: Window | null | undefined,
  docsUrl: string,
  displaySettings: QdnDisplaySettings,
) {
  if (!frameWindow) {
    return;
  }

  const targetOrigin = getPostMessageTargetOrigin(docsUrl);

  for (const message of getCoreApiDocsDisplaySettingMessages(displaySettings)) {
    frameWindow.postMessage(message, targetOrigin);
  }
}

export function CoreApiDocsPage({ displaySettings, nodeSettings }: CoreApiDocsPageProps) {
  const [retryToken, setRetryToken] = useState(0);
  const [state, setState] = useState<DocsState>({ phase: 'checking' });
  const displaySettingsRef = useRef(displaySettings);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const isEnablingRef = useRef(false);
  const docsUrl = `${nodeSettings.nodeApiUrl}${DOCS_PATH}`;
  const isNetworkMode = nodeSettings.mode === 'network';

  useEffect(() => {
    displaySettingsRef.current = displaySettings;
    postCoreApiDocsDisplaySettings(frameRef.current?.contentWindow, docsUrl, displaySettings);
  }, [displaySettings, docsUrl]);

  useEffect(() => {
    let isDisposed = false;

    if (isEnablingRef.current) {
      return undefined;
    }

    setState({ phase: 'checking' });

    async function checkApiDocumentation() {
      try {
        const probeResult = await probeApiDocumentation();

        if (isDisposed) {
          return;
        }

        if (probeResult.kind === 'available') {
          setState({
            frameSrc: buildCoreApiDocsFrameUrl(docsUrl, Date.now(), displaySettingsRef.current),
            phase: 'available',
          });
        } else if (probeResult.kind === 'disabled') {
          setState({ phase: 'disabled' });
        } else {
          setState({
            phase: 'error',
            message: t('api.httpStatus', { status: probeResult.status }),
          });
        }
      } catch (error) {
        if (!isDisposed) {
          setState({
            phase: 'error',
            message: formatError(error),
          });
        }
      }
    }

    void checkApiDocumentation();

    return () => {
      isDisposed = true;
    };
  }, [docsUrl, retryToken]);

  useEffect(() => {
    return () => {
      isEnablingRef.current = false;
    };
  }, []);

  async function enableApiDocumentationAndRestart() {
    isEnablingRef.current = true;
    setState({ phase: 'enabling' });

    try {
      await window.qortiumHome.node.enableApiDocumentation();
    } catch (error) {
      isEnablingRef.current = false;
      setState({
        phase: 'error',
        message: formatError(error),
      });
      return;
    }

    setState({ phase: 'restarting' });

    const pollDeadline = Date.now() + RESTART_POLL_TIMEOUT_MS;

    while (Date.now() < pollDeadline) {
      await delay(RESTART_POLL_INTERVAL_MS);

      if (!isEnablingRef.current) {
        return;
      }

      try {
        const probeResult = await probeApiDocumentation();

        if (probeResult.kind === 'available') {
          isEnablingRef.current = false;
          setState({
            frameSrc: buildCoreApiDocsFrameUrl(docsUrl, Date.now(), displaySettingsRef.current),
            phase: 'available',
          });
          return;
        }
      } catch {
        // The node is restarting; keep polling until the deadline.
      }
    }

    isEnablingRef.current = false;
    setState({
      phase: 'error',
      message: t('coreApi.restartTimeout'),
    });
  }

  const statusLabel = state.phase === 'error' ? t('common.error') : t('coreApi.title');

  return (
    <section className="qdn-viewer core-api-docs" aria-label={t('coreApi.title')}>
      <div className="qdn-viewer__status" aria-live="polite">
        <div className="qdn-viewer__status-text">
          <span className="qdn-viewer__status-label">{statusLabel}</span>
          <span className="qdn-viewer__resource">{docsUrl}</span>
        </div>
      </div>

      {state.phase === 'checking' ? (
        <div className="qdn-viewer__empty qdn-viewer__empty--loading">
          <p className="qdn-viewer__message">{t('coreApi.checking')}</p>
        </div>
      ) : null}

      {state.phase === 'enabling' || state.phase === 'restarting' ? (
        <div className="qdn-viewer__empty qdn-viewer__empty--loading">
          <p className="qdn-viewer__message">
            {state.phase === 'enabling' ? t('coreApi.enabling') : t('coreApi.restarting')}
          </p>
        </div>
      ) : null}

      {state.phase === 'disabled' ? (
        <div className="qdn-viewer__empty qdn-viewer__empty--ready">
          <div className="qdn-viewer__details core-api-docs__details">
            <h2 className="core-api-docs__title">{t('coreApi.disabledTitle')}</h2>
            <p className="qdn-viewer__message">{t('coreApi.disabledBody')}</p>
            {isNetworkMode ? (
              <p className="qdn-viewer__message">{t('coreApi.networkMode')}</p>
            ) : (
              <>
                <p className="qdn-viewer__message">{t('coreApi.enableHint')}</p>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={enableApiDocumentationAndRestart}
                >
                  <Power aria-hidden="true" size={18} strokeWidth={2} />
                  {t('coreApi.enableButton')}
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {state.phase === 'error' ? (
        <div className="qdn-viewer__empty qdn-viewer__empty--error">
          <p className="qdn-viewer__message">{state.message}</p>
          <button
            className="button qdn-viewer__retry"
            type="button"
            onClick={() => setRetryToken((currentToken) => currentToken + 1)}
          >
            <RefreshCw aria-hidden="true" size={18} strokeWidth={2} />
            {t('common.retry')}
          </button>
        </div>
      ) : null}

      {state.phase === 'available' ? (
        <iframe
          className="qdn-viewer__frame"
          title={t('coreApi.title')}
          src={state.frameSrc}
          ref={frameRef}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms"
          onLoad={() => {
            postCoreApiDocsDisplaySettings(frameRef.current?.contentWindow, docsUrl, displaySettingsRef.current);
          }}
        />
      ) : null}
    </section>
  );
}
