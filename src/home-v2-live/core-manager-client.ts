import type {
  HomeV2CoreManagerActionResult,
  HomeV2CoreManagerStatus,
  HomeV2CoreNetwork,
} from '../../electron/home-v2-core-manager-contract'

export interface HomeV2CoreManagerClient {
  getStatus(network: HomeV2CoreNetwork): Promise<HomeV2CoreManagerStatus>
  start(network: HomeV2CoreNetwork): Promise<HomeV2CoreManagerActionResult>
  stop(network: HomeV2CoreNetwork): Promise<HomeV2CoreManagerActionResult>
}

declare global {
  interface Window {
    homeV2CoreManagers?: HomeV2CoreManagerClient
  }
}

