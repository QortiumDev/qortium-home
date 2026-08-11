import type {
  HomeV2CreateAccountRequest,
  HomeV2ImportPrivateKeyRequest,
  HomeV2UnlockAccountRequest,
  HomeV2VaultState,
} from '../v2/contracts'

export type HomeV2WalletFileSelection =
  | { canceled: true }
  | {
      accountId: string
      address: string
      canceled: false
      suggestedName: string
      token: string
    }

export interface HomeV2VaultClient {
  addAddress(accountId: string): Promise<HomeV2VaultState>
  create(request: HomeV2CreateAccountRequest): Promise<{ canceled: boolean; state: HomeV2VaultState }>
  discardLoadedWallet(token: string): Promise<void>
  exportAccount(accountId: string): Promise<{ canceled: boolean; fileName?: string; uri?: string }>
  getPrivateKeyAddress(privateKey: string): Promise<string>
  getState(): Promise<HomeV2VaultState>
  importPrivateKey(
    request: HomeV2ImportPrivateKeyRequest,
  ): Promise<{ canceled: boolean; state: HomeV2VaultState }>
  lock(accountId: string): Promise<HomeV2VaultState>
  removeAccount(request: { accountId: string; password?: string }): Promise<HomeV2VaultState>
  removeAddress(addressId: string): Promise<HomeV2VaultState>
  rename(request: { accountId: string; label: string }): Promise<HomeV2VaultState>
  requestRestore(): Promise<{ restartRequired: boolean }>
  saveLoadedWallet(request: { label: string; token: string }): Promise<HomeV2VaultState>
  select(request: { accountId: string | null; addressId: string | null }): Promise<HomeV2VaultState>
  selectWalletFile(): Promise<HomeV2WalletFileSelection>
  unlock(request: HomeV2UnlockAccountRequest): Promise<HomeV2VaultState>
  updateSecurity(request: {
    accountId: string
    lockOnExit?: boolean
    password?: string
    rememberUnlock?: boolean
  }): Promise<HomeV2VaultState>
}

export function getHomeV2VaultClient() {
  if (!window.homeV2Vault) throw new Error('Account management is unavailable on this platform.')
  return window.homeV2Vault
}

declare global {
  interface Window {
    homeV2Vault?: HomeV2VaultClient
  }
}
