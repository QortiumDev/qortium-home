export type HomeV2CoreOperationNetwork = 'qortal' | 'qortium'

export type HomeV2CoreOperationLease = Readonly<{
  release(): void
  revision: number
}>

class HomeV2CoreOperationCoordinator {
  #activeNetworks = new Set<HomeV2CoreOperationNetwork>()
  #automaticRevision = 0
  #startActive = false

  get automaticRevision() {
    return this.#automaticRevision
  }

  revokeAutomaticWork() {
    this.#automaticRevision += 1
    return this.#automaticRevision
  }

  isAutomaticRevisionCurrent(revision: number) {
    return revision === this.#automaticRevision
  }

  tryBeginInteractive(
    networks: readonly HomeV2CoreOperationNetwork[],
    options: { readonly serializeStart?: boolean } = {},
  ): HomeV2CoreOperationLease | null {
    this.revokeAutomaticWork()
    return this.#tryBegin(networks, this.#automaticRevision, options.serializeStart === true)
  }

  tryBeginAutomatic(
    networks: readonly HomeV2CoreOperationNetwork[],
    expectedRevision: number,
  ): HomeV2CoreOperationLease | null {
    if (!this.isAutomaticRevisionCurrent(expectedRevision)) return null
    return this.#tryBegin(networks, expectedRevision, false)
  }

  #tryBegin(
    networks: readonly HomeV2CoreOperationNetwork[],
    revision: number,
    serializeStart: boolean,
  ): HomeV2CoreOperationLease | null {
    const unique = [...new Set(networks)]
    if (unique.length === 0 || unique.some((network) => this.#activeNetworks.has(network)) ||
      (serializeStart && this.#startActive)) return null

    unique.forEach((network) => this.#activeNetworks.add(network))
    if (serializeStart) this.#startActive = true
    let released = false
    return Object.freeze({
      release: () => {
        if (released) return
        released = true
        unique.forEach((network) => this.#activeNetworks.delete(network))
        if (serializeStart) this.#startActive = false
      },
      revision,
    })
  }
}

export const homeV2CoreOperationCoordinator = new HomeV2CoreOperationCoordinator()
