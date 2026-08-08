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

export type FixturePlatform = 'android' | 'electron' | 'generic'

export class FixtureBoundaryError extends Error {
  readonly code = 'FIXTURE_BOUNDARY'

  constructor(
    readonly capability: FixtureCapability,
    readonly platform: FixturePlatform = 'generic',
  ) {
    super(`${platform} fixture host cannot access ${capability}`)
    this.name = 'FixtureBoundaryError'
  }
}

export class FixturePlatformHost implements HomeV2Host {
  constructor(
    readonly platform: FixturePlatform,
    private readonly snapshot: HomeV2Snapshot,
  ) {}

  async getSnapshot(): Promise<HomeV2Snapshot> {
    return this.snapshot
  }

  async requestNetwork(_request: NetworkRequest): Promise<never> {
    throw new FixtureBoundaryError('network', this.platform)
  }

  async readFile(_request: FileReadRequest): Promise<never> {
    throw new FixtureBoundaryError('filesystem', this.platform)
  }

  async unlockVault(_context: OperationContext): Promise<never> {
    throw new FixtureBoundaryError('vault', this.platform)
  }

  async signIntent(_intent: SigningIntent): Promise<never> {
    throw new FixtureBoundaryError('signing', this.platform)
  }

  async manageNativeService(_request: ManagedServiceRequest): Promise<never> {
    throw new FixtureBoundaryError('managed-service', this.platform)
  }
}

export class MockHost extends FixturePlatformHost {
  constructor(snapshot: HomeV2Snapshot) {
    super('generic', snapshot)
  }
}

export function createElectronFixtureHost(
  snapshot: HomeV2Snapshot,
): FixturePlatformHost {
  return new FixturePlatformHost('electron', snapshot)
}

export function createAndroidFixtureHost(
  snapshot: HomeV2Snapshot,
): FixturePlatformHost {
  return new FixturePlatformHost('android', snapshot)
}
