import { userMessage } from './user-message.js';
import type { CoreNetworkId } from './core-network-descriptor.js';

export type CoreInstallChannel = 'github' | 'helpers' | 'on-chain';

const activeChannels = new Map<CoreNetworkId, CoreInstallChannel>();

/** @deprecated Use isCoreInstallActiveForNetwork with an explicit network ID. */
export function isCoreInstallActive() {
  return isCoreInstallActiveForNetwork('qortium');
}

export function isCoreInstallActiveForNetwork(networkId: CoreNetworkId) {
  return activeChannels.has(networkId);
}

/** @deprecated Use withCoreInstallLockForNetwork with an explicit network ID. */
export async function withCoreInstallLock<T>(channel: CoreInstallChannel, operation: () => Promise<T>): Promise<T> {
  return await withCoreInstallLockForNetwork('qortium', channel, operation);
}

export async function withCoreInstallLockForNetwork<T>(
  networkId: CoreNetworkId,
  channel: CoreInstallChannel,
  operation: () => Promise<T>,
): Promise<T> {
  const activeChannel = activeChannels.get(networkId);

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

  activeChannels.set(networkId, channel);

  try {
    return await operation();
  } finally {
    activeChannels.delete(networkId);
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
