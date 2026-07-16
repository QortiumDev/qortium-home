import { userMessage } from './user-message.js';

export type CoreInstallChannel = 'github' | 'helpers' | 'on-chain';

let activeChannel: CoreInstallChannel | null = null;

export function isCoreInstallActive() {
  return activeChannel !== null;
}

export async function withCoreInstallLock<T>(channel: CoreInstallChannel, operation: () => Promise<T>): Promise<T> {
  if (activeChannel) {
    throw new Error(
      userMessage(
        activeChannel === 'github'
          ? 'core.error.installLockedGithub'
          : activeChannel === 'helpers'
            ? 'core.error.installLockedHelpers'
            : 'core.error.installLockedOnChain',
      ),
    );
  }

  activeChannel = channel;

  try {
    return await operation();
  } finally {
    activeChannel = null;
  }
}

function normalizeStatus(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function isOnChainCoreInstallActive(value: unknown) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const status = value as Record<string, unknown>;
  const statusCode = normalizeStatus(status.status);
  const resourceStatus = normalizeStatus(status.binaryResourceStatus);

  return (
    status.installStarted === true ||
    status.installing === true ||
    statusCode === 'DOWNLOAD_STARTED' ||
    statusCode === 'INSTALL_IN_PROGRESS' ||
    typeof status.nextRetryTimestamp === 'number' ||
    resourceStatus === 'BUILDING' ||
    resourceStatus === 'DOWNLOADING'
  );
}
