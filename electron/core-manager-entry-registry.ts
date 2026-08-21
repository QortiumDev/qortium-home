export type NetworkManagerEntry<NetworkId extends string> = {
  readonly networkId: NetworkId;
};

export class NetworkManagerEntryRegistry<
  NetworkId extends string,
  Entry extends NetworkManagerEntry<NetworkId>,
> {
  readonly #entries = new Map<NetworkId, Entry>();

  constructor(entries: readonly Entry[]) {
    for (const entry of entries) {
      if (this.#entries.has(entry.networkId)) {
        throw new Error(`A Core manager is already registered for ${entry.networkId}.`);
      }

      this.#entries.set(entry.networkId, entry);
    }
  }

  get(networkId: NetworkId) {
    return this.#entries.get(networkId) ?? null;
  }

  listNetworkIds() {
    return [...this.#entries.keys()];
  }

  require(networkId: NetworkId) {
    const entry = this.get(networkId);

    if (!entry) {
      throw new Error(`No Core manager is registered for ${networkId}.`);
    }

    return entry;
  }
}
