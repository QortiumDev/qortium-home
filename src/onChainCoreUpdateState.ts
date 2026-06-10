import { useCallback, useEffect, useState } from 'react';
import { t } from './i18n';

export type OnChainCoreUpdateState =
  | {
      state: 'loading';
    }
  | {
      message: string;
      state: 'unavailable';
    }
  | {
      state: 'available';
      status: QortiumCoreOnChainUpdateStatus;
    }
  | {
      status?: QortiumCoreOnChainUpdateStatus;
      state: 'installing';
    };

const ON_CHAIN_CORE_UPDATE_POLL_INTERVAL_MS = 5000;
const ACTIVE_ON_CHAIN_QDN_RESOURCE_STATUSES = new Set(['BUILDING', 'DOWNLOADING']);

export function formatCoreAdminError(error: unknown) {
  if (!(error instanceof Error)) {
    return t('core.onChain.checkFailed');
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function getOnChainCoreUpdateUnavailableMessage(nodeSettings: QortiumNodeSettings) {
  if (nodeSettings.mode === 'network') {
    return t('core.onChain.requiresLocalCore');
  }

  if (nodeSettings.mode === 'custom' && !nodeSettings.apiKey) {
    return t('core.onChain.saveApiKey');
  }

  return null;
}

function normalizeOnChainUpdateStatusCode(value: string | null | undefined) {
  return (value || '').toUpperCase();
}

export function isOnChainQdnResourceActive(status: QortiumCoreOnChainUpdateStatus) {
  const resourceStatus = normalizeOnChainUpdateStatusCode(status.binaryResourceStatus);

  return ACTIVE_ON_CHAIN_QDN_RESOURCE_STATUSES.has(resourceStatus);
}

export function isOnChainCoreUpdateAttemptActive(status: QortiumCoreOnChainUpdateStatus) {
  const statusCode = normalizeOnChainUpdateStatusCode(status.status);

  return (
    !!status.installStarted ||
    !!status.installing ||
    statusCode === 'DOWNLOAD_STARTED' ||
    statusCode === 'INSTALL_IN_PROGRESS' ||
    typeof status.nextRetryTimestamp === 'number'
  );
}

function shouldPollOnChainCoreUpdateStatus(status: QortiumCoreOnChainUpdateStatus) {
  return !!status.updateAvailable && (isOnChainCoreUpdateAttemptActive(status) || isOnChainQdnResourceActive(status));
}

export function getOnChainCoreUpdateSummary(updateState: OnChainCoreUpdateState) {
  if (updateState.state !== 'available' || !updateState.status.updateAvailable) {
    return '';
  }

  if (updateState.status.installStarted) {
    return t('core.onChain.installScheduled');
  }

  if (updateState.status.installing) {
    return t('core.onChain.installInProgress');
  }

  if (isOnChainCoreUpdateAttemptActive(updateState.status)) {
    return t('core.onChain.downloadingWillRetry');
  }

  if (isOnChainQdnResourceActive(updateState.status)) {
    return t('core.onChain.downloading');
  }

  if (updateState.status.downloadStarted) {
    return t('core.onChain.downloadRequested');
  }

  if (updateState.status.autoUpdateMode === 'INSTALL') {
    return t('core.onChain.availableAutoInstall');
  }

  return t('core.onChain.available');
}

export function useOnChainCoreUpdate(nodeSettings: QortiumNodeSettings | null) {
  const [status, setStatus] = useState<OnChainCoreUpdateState>({ state: 'loading' });

  const refreshStatus = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (!nodeSettings) {
      setStatus({ state: 'loading' });
      return;
    }

    const unavailableMessage = getOnChainCoreUpdateUnavailableMessage(nodeSettings);

    if (unavailableMessage) {
      setStatus({
        message: unavailableMessage,
        state: 'unavailable',
      });
      return;
    }

    if (!options.quiet) {
      setStatus({ state: 'loading' });
    }

    try {
      setStatus({
        state: 'available',
        status: await window.qortiumHome.node.checkCoreUpdate(),
      });
    } catch (error) {
      setStatus({
        message: formatCoreAdminError(error),
        state: 'unavailable',
      });
    }
  }, [nodeSettings?.apiKey, nodeSettings?.mode, nodeSettings?.nodeApiUrl]);

  const installUpdate = useCallback(async () => {
    const currentStatus = status.state === 'available' ? status.status : undefined;

    setStatus({
      state: 'installing',
      status: currentStatus,
    });

    try {
      setStatus({
        state: 'available',
        status: await window.qortiumHome.node.installCoreUpdate(),
      });
    } catch (error) {
      setStatus({
        message: formatCoreAdminError(error),
        state: 'unavailable',
      });
    }
  }, [status]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (status.state !== 'available' || !shouldPollOnChainCoreUpdateStatus(status.status)) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void refreshStatus({ quiet: true });
    }, ON_CHAIN_CORE_UPDATE_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshStatus, status]);

  return {
    installUpdate,
    isBusy: status.state === 'loading' || status.state === 'installing',
    refreshStatus,
    status,
  };
}

export type OnChainCoreUpdateController = ReturnType<typeof useOnChainCoreUpdate>;
