export type CoreManagerConfirmation = {
  expiresAt: string;
  targetVersion: string;
  token: string;
};

export type CoreManagerNetworkState<Status, Confirmation extends CoreManagerConfirmation> = {
  coreLayoutMigrationPromise: Promise<void> | null;
  downgradeConfirmations: Map<string, Confirmation>;
  managedJavaInstallPromise: Promise<unknown> | null;
  managedJavaMetadataQueue: Promise<void>;
  managedJavaRefreshInFlight: boolean;
  updateEnginePromise: Promise<void> | null;
  updateEngineRerunPromise: Promise<void> | null;
  updateEngineStatus: Status;
  updateInterval: NodeJS.Timeout | null;
};

export class CoreManagerStateRegistry<
  NetworkId extends string,
  Status,
  Confirmation extends CoreManagerConfirmation,
> {
  readonly #createInitialStatus: () => Status;
  readonly #states = new Map<NetworkId, CoreManagerNetworkState<Status, Confirmation>>();

  constructor(createInitialStatus: () => Status) {
    this.#createInitialStatus = createInitialStatus;
  }

  forNetwork(networkId: NetworkId) {
    let state = this.#states.get(networkId);

    if (!state) {
      state = {
        coreLayoutMigrationPromise: null,
        downgradeConfirmations: new Map<string, Confirmation>(),
        managedJavaInstallPromise: null,
        managedJavaMetadataQueue: Promise.resolve(),
        managedJavaRefreshInFlight: false,
        updateEnginePromise: null,
        updateEngineRerunPromise: null,
        updateEngineStatus: this.#createInitialStatus(),
        updateInterval: null,
      };
      this.#states.set(networkId, state);
    }

    return state;
  }

  ensureLayout(networkId: NetworkId, migrate: () => Promise<void>) {
    const state = this.forNetwork(networkId);

    if (!state.coreLayoutMigrationPromise) {
      state.coreLayoutMigrationPromise = Promise.resolve()
        .then(migrate)
        .catch((error) => {
          state.coreLayoutMigrationPromise = null;
          throw error;
        });
    }

    return state.coreLayoutMigrationPromise;
  }

  scheduleManagedJavaRefresh(networkId: NetworkId, refresh: () => Promise<void>) {
    const state = this.forNetwork(networkId);

    if (state.managedJavaRefreshInFlight) {
      return false;
    }

    state.managedJavaRefreshInFlight = true;
    void Promise.resolve()
      .then(refresh)
      .catch(() => {})
      .finally(() => {
        state.managedJavaRefreshInFlight = false;
      });
    return true;
  }

  runManagedJavaInstall<Result>(networkId: NetworkId, install: () => Promise<Result>) {
    const state = this.forNetwork(networkId);

    if (state.managedJavaInstallPromise) {
      return state.managedJavaInstallPromise as Promise<Result>;
    }

    const promise = Promise.resolve().then(install).finally(() => {
      if (state.managedJavaInstallPromise === promise) {
        state.managedJavaInstallPromise = null;
      }
    });

    state.managedJavaInstallPromise = promise;
    return promise;
  }

  queueManagedJavaMetadataMutation<Result>(networkId: NetworkId, mutate: () => Promise<Result>) {
    const state = this.forNetwork(networkId);
    const result = state.managedJavaMetadataQueue.then(mutate, mutate);

    state.managedJavaMetadataQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  runUpdateEngine(networkId: NetworkId, run: () => Promise<void>) {
    const state = this.forNetwork(networkId);

    if (state.updateEnginePromise) {
      return state.updateEnginePromise;
    }

    const promise = Promise.resolve().then(run).finally(() => {
      if (state.updateEnginePromise === promise) {
        state.updateEnginePromise = null;
      }
    });

    state.updateEnginePromise = promise;
    return promise;
  }

  runUpdateEngineAfterPolicyChange(networkId: NetworkId, run: () => Promise<void>) {
    const state = this.forNetwork(networkId);

    if (!state.updateEnginePromise) {
      return this.runUpdateEngine(networkId, run);
    }

    if (!state.updateEngineRerunPromise) {
      const rerunPromise = state.updateEnginePromise
        .then(() => this.runUpdateEngine(networkId, run))
        .finally(() => {
          if (state.updateEngineRerunPromise === rerunPromise) {
            state.updateEngineRerunPromise = null;
          }
        });

      state.updateEngineRerunPromise = rerunPromise;
    }

    return state.updateEngineRerunPromise;
  }

  ensureUpdateInterval(networkId: NetworkId, create: () => NodeJS.Timeout) {
    const state = this.forNetwork(networkId);

    if (state.updateInterval) {
      return false;
    }

    state.updateInterval = create();
    return true;
  }

  storeDowngradeConfirmation(networkId: NetworkId, confirmation: Confirmation, nowMs = Date.now()) {
    const confirmations = this.forNetwork(networkId).downgradeConfirmations;

    for (const [token, current] of confirmations) {
      if (Date.parse(current.expiresAt) <= nowMs) {
        confirmations.delete(token);
      }
    }

    confirmations.set(confirmation.token, confirmation);
  }

  consumeDowngradeConfirmation(
    networkId: NetworkId,
    token: string,
    targetVersion: string,
    nowMs = Date.now(),
  ) {
    const confirmations = this.forNetwork(networkId).downgradeConfirmations;
    const confirmation = confirmations.get(token);

    if (!confirmation) {
      return false;
    }

    confirmations.delete(token);
    return confirmation.targetVersion === targetVersion && Date.parse(confirmation.expiresAt) > nowMs;
  }
}
