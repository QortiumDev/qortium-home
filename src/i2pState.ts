import { useCallback, useEffect, useState } from 'react';
import { deriveI2pStatus, type I2pStatus } from './i2p';
import { fetchCoreTransportStatus } from './platform';

export type I2pConnectionsState = {
  status: I2pStatus | null;
  isLoading: boolean;
  isUnavailable: boolean;
  refresh: () => void;
};

// Reads the node's I2P transport status (config + live peer transports) and
// refreshes when the node connection changes or refresh() is called.
export function useI2pConnections(nodeApiUrl: string): I2pConnectionsState {
  const [status, setStatus] = useState<I2pStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      const snapshot = await fetchCoreTransportStatus();

      if (cancelled) {
        return;
      }

      if (snapshot) {
        setStatus(deriveI2pStatus(snapshot.settings, snapshot.chainPeers, snapshot.dataPeers));
        setIsUnavailable(false);
      } else {
        setStatus(null);
        setIsUnavailable(true);
      }

      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [nodeApiUrl, refreshToken]);

  return { status, isLoading, isUnavailable, refresh };
}
