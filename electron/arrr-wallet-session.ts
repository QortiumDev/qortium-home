export const ARRR_WALLET_SESSION_CONTRACT = 'qortium-arrr-wallet-session-v1' as const
export type ArrrWalletSession = Readonly<{
  contract: typeof ARRR_WALLET_SESSION_CONTRACT
  revision: string
  enabled: boolean
  relation: 'SELF' | 'OTHER' | 'NONE'
  lifecycle: 'NEW' | 'RUNNING' | 'STOPPING' | 'TERMINATED' | 'DEGRADED'
  address: string | null
}>
export type ArrrWalletSessionRequest = Readonly<{ operation: 'status' | 'activate'; expectedRevision?: string }>
export function parseArrrWalletSession(value: unknown): ArrrWalletSession {
  const v = value as Record<string, unknown> | null
  if (!v || v.contract !== ARRR_WALLET_SESSION_CONTRACT || typeof v.revision !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(v.revision) || typeof v.enabled !== 'boolean' ||
      !['SELF', 'OTHER', 'NONE'].includes(String(v.relation)) ||
      !['NEW', 'RUNNING', 'STOPPING', 'TERMINATED', 'DEGRADED'].includes(String(v.lifecycle)) ||
      !(v.address == null || (typeof v.address === 'string' && /^zs[0-9a-z]{20,180}$/.test(v.address)))) {
    throw new Error('Core returned an invalid ARRR wallet session.')
  }
  return Object.freeze({ contract: ARRR_WALLET_SESSION_CONTRACT, revision: v.revision,
    enabled: v.enabled, relation: v.relation as ArrrWalletSession['relation'],
    lifecycle: v.lifecycle as ArrrWalletSession['lifecycle'], address: (v.address ?? null) as string | null })
}
