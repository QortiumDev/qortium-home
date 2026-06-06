import { useCallback, useEffect, useState } from 'react';

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
    return 'Unable to check approved on-chain Core updates.';
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function getOnChainCoreUpdateUnavailableMessage(nodeSettings: QortiumNodeSettings) {
  if (nodeSettings.mode === 'network') {
    return 'Requires a local Core or trusted custom node with API key.';
  }

  if (nodeSettings.mode === 'custom' && !nodeSettings.apiKey) {
    return 'Save the custom node API key to check approved on-chain Core updates.';
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
    return 'Approved Core update install has been scheduled.';
  }

  if (updateState.status.installing) {
    return 'Approved Core update install is in progress.';
  }

  if (isOnChainCoreUpdateAttemptActive(updateState.status)) {
    return 'Approved Core update data is downloading from QDN. Core will retry the install when the data is local.';
  }

  if (isOnChainQdnResourceActive(updateState.status)) {
    return 'Approved Core update data is downloading from QDN.';
  }

  if (updateState.status.downloadStarted) {
    return 'Approved Core update data download was requested.';
  }

  if (updateState.status.autoUpdateMode === 'INSTALL') {
    return 'Approved Core update available. Core auto-update is enabled and will install it automatically.';
  }

  return 'Approved Core update available.';
}

export function useOnChainCoreUpdate(nodeSettings: QortiumNodeSettings) {
  const [status, setStatus] = useState<OnChainCoreUpdateState>({ state: 'loading' });

  const refreshStatus = useCallback(async (options: { quiet?: boolean } = {}) => {
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
  }, [nodeSettings.apiKey, nodeSettings.mode, nodeSettings.nodeApiUrl]);

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
