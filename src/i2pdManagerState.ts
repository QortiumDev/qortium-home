import { useCallback, useEffect, useState } from 'react';

// Renderer-side state for Home's managed i2pd (desktop only). Reads status from
// the window.qortiumHome.i2pd bridge and exposes enable/disable actions. When the
// bridge is absent (Android, or a build without it) `supported` is false and the
// UI should leave I2P availability ungated.

export type I2pdManagerState = {
  supported: boolean;
  status: QortiumI2pdStatus | null;
  isLoading: boolean;
  isBusy: boolean;
  error: string | null;
  progress: string | null;
  refresh: () => void;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
};

function getBridge() {
  return typeof window !== 'undefined' ? window.qortiumHome?.i2pd : undefined;
}

export function useI2pdManager(enabled: boolean): I2pdManagerState {
  const bridge = getBridge();
  const supported = Boolean(bridge);

  const [status, setStatus] = useState<QortiumI2pdStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  useEffect(() => {
    if (!bridge || !enabled) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    bridge
      .getStatus()
      .then((next) => {
        if (!cancelled) {
          setStatus(next);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bridge, enabled, refreshToken]);

  useEffect(() => {
    if (!bridge?.onProgress) {
      return;
    }

    return bridge.onProgress((next) => setProgress(next.message ?? null));
  }, [bridge]);

  const run = useCallback(
    async (action: () => Promise<QortiumI2pdStatus>) => {
      setIsBusy(true);
      setError(null);
      try {
        setStatus(await action());
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setIsBusy(false);
        setProgress(null);
      }
    },
    [],
  );

  // "Enable" installs i2pd if needed, then starts it.
  const enable = useCallback(async () => {
    if (!bridge) {
      return;
    }
    await run(async () => {
      const current = await bridge.getStatus();
      if (!current.installed) {
        await bridge.install();
      }
      return bridge.start();
    });
  }, [bridge, run]);

  const disable = useCallback(async () => {
    if (!bridge) {
      return;
    }
    await run(() => bridge.stop());
  }, [bridge, run]);

  return { supported, status, isLoading, isBusy, error, progress, refresh, enable, disable };
}
