import { Copy, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { t, type TranslationKey } from './i18n';
import type { NodeApiRoute } from './routes';

const API_PREVIEW_MAX_BYTES = 1_048_576;
const BYTE_UNIT_KEYS: readonly TranslationKey[] = ['common.unit.kb', 'common.unit.mb', 'common.unit.gb', 'common.unit.tb'];

type ApiViewerState =
  | {
      phase: 'loading';
    }
  | {
      body: string;
      contentLength?: number;
      contentType: string;
      displayBody: string;
      displayType: string;
      status: number;
      statusText: string;
      phase: 'ready';
    }
  | {
      contentLength?: number;
      contentType: string;
      status: number;
      statusText: string;
      phase: 'too-large';
    }
  | {
      message: string;
      phase: 'error';
    };

type ApiViewerProps = {
  route: NodeApiRoute;
};

function formatError(error: unknown) {
  if (!(error instanceof Error)) {
    return t('api.loadFailed');
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function formatBytes(bytes: number | undefined) {
  if (typeof bytes !== 'number') {
    return '';
  }

  if (bytes < 1024) {
    return t('common.unit.bytes', { count: bytes.toLocaleString() });
  }

  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < BYTE_UNIT_KEYS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return t(BYTE_UNIT_KEYS[unitIndex], { value: value.toLocaleString(undefined, { maximumFractionDigits: 1 }) });
}

function formatPreviewLimit() {
  return formatBytes(API_PREVIEW_MAX_BYTES) || t('common.unit.mb', { value: 1 });
}

function formatApiBody(body: string, contentType: string) {
  if (/\bjson\b/i.test(contentType)) {
    try {
      return {
        displayBody: JSON.stringify(JSON.parse(body), null, 2),
        displayType: 'JSON',
      };
    } catch {
      return {
        displayBody: body,
        displayType: contentType.split(';')[0] || t('common.formatText'),
      };
    }
  }

  return {
    displayBody: body,
    displayType: contentType.split(';')[0] || t('common.formatText'),
  };
}

async function writeClipboardText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.append(textArea);
  textArea.focus();
  textArea.select();

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Clipboard copy was not available.');
    }
  } finally {
    textArea.remove();
  }
}

function CopyButton({
  disabled,
  label,
  value,
}: {
  disabled?: boolean;
  label: string;
  value: string;
}) {
  const [copyState, setCopyState] = useState<'copied' | 'error' | 'idle'>('idle');
  const buttonLabel = copyState === 'copied' ? t('common.copied') : copyState === 'error' ? t('common.copyFailed') : label;

  useEffect(() => {
    if (copyState === 'idle') {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setCopyState('idle'), 1_600);

    return () => window.clearTimeout(timeoutId);
  }, [copyState]);

  return (
    <button
      className="button button--secondary"
      type="button"
      disabled={disabled}
      onClick={async () => {
        try {
          await writeClipboardText(value);
          setCopyState('copied');
        } catch {
          setCopyState('error');
        }
      }}
    >
      <Copy aria-hidden="true" size={18} strokeWidth={2} />
      {buttonLabel}
    </button>
  );
}

function ApiDetailList({ state, route }: { route: NodeApiRoute; state: Exclude<ApiViewerState, { phase: 'loading' | 'error' }> }) {
  return (
    <dl className="detail-list qdn-viewer__detail-list">
      <div className="detail-list__row">
        <dt className="detail-list__label">{t('common.endpoint')}</dt>
        <dd className="detail-list__value">{route.path}</dd>
      </div>
      <div className="detail-list__row">
        <dt className="detail-list__label">{t('common.status')}</dt>
        <dd className="detail-list__value">
          {state.statusText
            ? t('api.httpStatusWithText', { status: state.status, statusText: state.statusText })
            : t('api.httpStatus', { status: state.status })}
        </dd>
      </div>
      {state.contentType ? (
        <div className="detail-list__row">
          <dt className="detail-list__label">{t('common.type')}</dt>
          <dd className="detail-list__value">{state.contentType}</dd>
        </div>
      ) : null}
      {state.contentLength ? (
        <div className="detail-list__row">
          <dt className="detail-list__label">{t('common.size')}</dt>
          <dd className="detail-list__value">{formatBytes(state.contentLength)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export function ApiViewer({ route }: ApiViewerProps) {
  const [retryToken, setRetryToken] = useState(0);
  const [state, setState] = useState<ApiViewerState>({
    phase: 'loading',
  });

  useEffect(() => {
    let isDisposed = false;

    setState({
      phase: 'loading',
    });

    async function loadApiEndpoint() {
      try {
        const result = await window.qortiumHome.qdn.fetchNodeApi({
          path: route.path,
          maxBytes: API_PREVIEW_MAX_BYTES,
        });

        if (isDisposed) {
          return;
        }

        if (result.tooLarge) {
          setState({
            phase: 'too-large',
            contentLength: result.contentLength,
            contentType: result.contentType,
            status: result.status,
            statusText: result.statusText,
          });
          return;
        }

        const formattedBody = formatApiBody(result.body, result.contentType);

        setState({
          phase: 'ready',
          body: result.body,
          contentLength: result.contentLength,
          contentType: result.contentType,
          status: result.status,
          statusText: result.statusText,
          ...formattedBody,
        });
      } catch (error) {
        if (!isDisposed) {
          setState({
            phase: 'error',
            message: formatError(error),
          });
        }
      }
    }

    void loadApiEndpoint();

    return () => {
      isDisposed = true;
    };
  }, [route, retryToken]);

  const statusLabel =
    state.phase === 'ready' || state.phase === 'too-large'
      ? t('api.httpStatus', { status: state.status })
      : state.phase === 'error'
        ? t('common.error')
        : t('common.loading');

  return (
    <section className="qdn-viewer" aria-label={t('api.ariaLabel')}>
      <div className="qdn-viewer__status" aria-live="polite">
        <div className="qdn-viewer__status-text">
          <span className="qdn-viewer__status-label">{statusLabel}</span>
          <span className="qdn-viewer__resource">{route.displayUrl}</span>
        </div>
      </div>

      {state.phase === 'loading' ? (
        <div className="qdn-viewer__empty qdn-viewer__empty--loading">
          <p className="qdn-viewer__message">{t('api.loadingEndpoint')}</p>
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

      {state.phase === 'ready' ? (
        <div className="qdn-viewer__text">
          <div className="qdn-viewer__text-toolbar">
            <span className="qdn-viewer__type-label">{state.displayType}</span>
            <div className="qdn-viewer__actions">
              <CopyButton label={t('api.copyResponse')} value={state.displayBody} />
              <CopyButton label={t('api.copyEndpoint')} value={route.displayUrl} />
            </div>
          </div>
          <pre className="qdn-viewer__text-content">
            <code>{state.displayBody}</code>
          </pre>
        </div>
      ) : null}

      {state.phase === 'too-large' ? (
        <div className="qdn-viewer__empty qdn-viewer__empty--ready">
          <div className="qdn-viewer__details">
            <p className="qdn-viewer__message">{t('api.previewTooLarge', { limit: formatPreviewLimit() })}</p>
            <ApiDetailList route={route} state={state} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
