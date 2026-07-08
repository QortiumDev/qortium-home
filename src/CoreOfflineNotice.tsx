import { Play, RefreshCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { getCoreRuntimeAction, type CoreManagerState } from './coreManagerState';
import { t } from './i18n';

// Both fetch layers (src/platform.ts and electron/qdn.ts) report a dead node
// with this exact message, while HTTP errors from a live node use a different
// "failed with HTTP <status>" message — so matching it separates "node
// unreachable / Core offline" from real resource errors (missing, forbidden).
const NODE_UNAVAILABLE_PATTERN = /Qortium node is unavailable at /;

export function isNodeUnavailableMessage(message: string | null | undefined) {
  return !!message && NODE_UNAVAILABLE_PATTERN.test(message);
}

type CoreOfflineNoticeProps = {
  coreManager: CoreManagerState;
  nodeEpoch: number;
  nodeMode: QortiumNodeSettingsMode;
  onRetry: () => void;
};

// Recovery state shown in place of the generic page-load error when the node
// is unreachable. In local managed-Core mode it offers the shared Start Core
// action (never auto-started); in custom/network modes it only explains that
// the configured node is unreachable, so no misleading local-Core action is
// shown there (Android has no managed core, so coreApi is undefined and the
// action is withheld the same way).
export function CoreOfflineNotice({ coreManager, nodeEpoch, nodeMode, onRetry }: CoreOfflineNoticeProps) {
  const lastEpochRef = useRef(nodeEpoch);
  const onRetryRef = useRef(onRetry);

  onRetryRef.current = onRetry;

  // nodeEpoch bumps when node reachability changes or the managed Core
  // finishes starting, so retry automatically instead of leaving the user on
  // a stale failure once the node is back.
  useEffect(() => {
    if (lastEpochRef.current === nodeEpoch) {
      return;
    }

    lastEpochRef.current = nodeEpoch;
    onRetryRef.current();
  }, [nodeEpoch]);

  const isLocalMode = nodeMode === 'local';
  const runtimeAction = isLocalMode && coreManager.coreApi ? getCoreRuntimeAction(coreManager) : null;
  const startAction = runtimeAction?.kind === 'start' ? runtimeAction : null;
  const isStarting = coreManager.busyAction === 'starting';
  const startProgressPercent = isStarting ? (coreManager.progressPercent ?? 5) : null;

  return (
    <div className="core-offline">
      <p className="qdn-viewer__message">
        {isLocalMode ? t('coreOffline.title') : t('coreOffline.nodeTitle')}
      </p>
      <p className="core-offline__detail">
        {isLocalMode ? t('coreOffline.message') : t('coreOffline.nodeMessage')}
      </p>
      {startProgressPercent !== null ? (
        <div
          className="qdn-viewer__progress-bar core-offline__progress"
          role="progressbar"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(startProgressPercent)}
        >
          <span style={{ width: `${startProgressPercent}%` }} />
        </div>
      ) : null}
      {coreManager.message?.kind === 'error' ? (
        <p className="core-offline__error" role="alert">
          {coreManager.message.text}
        </p>
      ) : null}
      <div className="core-offline__actions">
        {startAction ? (
          <button
            className="button"
            type="button"
            disabled={startAction.disabled}
            title={startAction.title}
            onClick={() => void startAction.onClick?.()}
          >
            <Play aria-hidden="true" size={18} strokeWidth={2} />
            {startAction.label}
          </button>
        ) : null}
        <button
          className="button button--secondary qdn-viewer__retry"
          type="button"
          disabled={isStarting}
          onClick={onRetry}
        >
          <RefreshCw aria-hidden="true" size={18} strokeWidth={2} />
          {t('common.retry')}
        </button>
      </div>
    </div>
  );
}
