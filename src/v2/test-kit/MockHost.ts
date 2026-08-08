import type {
  FileReadRequest,
  HomeV2Host,
  HomeV2Snapshot,
  ManagedServiceRequest,
  NetworkRequest,
  OperationContext,
  SigningIntent,
} from '../contracts'

export type FixtureCapability =
  | 'filesystem'
  | 'managed-service'
  | 'network'
  | 'signing'
  | 'vault'

export class FixtureBoundaryError extends Error {
  readonly code = 'FIXTURE_BOUNDARY'

  constructor(readonly capability: FixtureCapability) {
    super(`Fixture host cannot access ${capability}`)
    this.name = 'FixtureBoundaryError'
  }
}

export class MockHost implements HomeV2Host {
  constructor(private readonly snapshot: HomeV2Snapshot) {}

  async getSnapshot(): Promise<HomeV2Snapshot> {
    return this.snapshot
  }

  async requestNetwork(_request: NetworkRequest): Promise<never> {
    throw new FixtureBoundaryError('network')
  }

  async readFile(_request: FileReadRequest): Promise<never> {
    throw new FixtureBoundaryError('filesystem')
  }

  async unlockVault(_context: OperationContext): Promise<never> {
    throw new FixtureBoundaryError('vault')
  }

  async signIntent(_intent: SigningIntent): Promise<never> {
    throw new FixtureBoundaryError('signing')
  }

  async manageNativeService(_request: ManagedServiceRequest): Promise<never> {
    throw new FixtureBoundaryError('managed-service')
  }
}
