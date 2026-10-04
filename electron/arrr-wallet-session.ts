export const ARRR_WALLET_SESSION_CONTRACT = 'qortium-arrr-wallet-session-v1' as const
export type ArrrWalletSession = Readonly<{
  contract: typeof ARRR_WALLET_SESSION_CONTRACT
  revision: string
  enabled: boolean
  relation: 'SELF' | 'OTHER' | 'NONE'
  lifecycle: 'NEW' | 'RUNNING' | 'STOPPING' | 'TERMINATED' | 'DEGRADED'
  address: string | null
  scanStart?: Readonly<{ mode: 'RESTORE_FROM_HEIGHT' | 'NEW_AT_CURRENT_TIP'; height: number }>
}>
export type ArrrWalletSessionRequest = Readonly<{ operation: 'status' | 'activate'; expectedRevision?: string; scanMode?: 'RESUME' | 'RESTORE_FROM_HEIGHT' | 'NEW_AT_CURRENT_TIP'; restoreHeight?: number }>
export function parseArrrWalletSession(value: unknown): ArrrWalletSession {
  const v = value as Record<string, unknown> | null
  if (!v || v.contract !== ARRR_WALLET_SESSION_CONTRACT || typeof v.revision !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(v.revision) || typeof v.enabled !== 'boolean' ||
      !['SELF', 'OTHER', 'NONE'].includes(String(v.relation)) ||
      !['NEW', 'RUNNING', 'STOPPING', 'TERMINATED', 'DEGRADED'].includes(String(v.lifecycle)) ||
      !(v.address == null || (typeof v.address === 'string' && /^zs[0-9a-z]{20,180}$/.test(v.address)))) {
    throw new Error('Core returned an invalid ARRR wallet session.')
  }
  const saved = v.scanStart as Record<string, unknown> | undefined
  const height = saved?.height ?? v.restoreHeight
  const mode = saved?.mode ?? v.initializationMode
  const scanStart = v.relation === 'SELF' && Number.isSafeInteger(height) && Number(height) >= 1 && Number(height) <= 500_000_000 &&
    (mode === 'RESTORE_FROM_HEIGHT' || mode === 'NEW_AT_CURRENT_TIP')
    ? { mode, height: Number(height) } as NonNullable<ArrrWalletSession['scanStart']> : undefined
  return Object.freeze({ contract: ARRR_WALLET_SESSION_CONTRACT, ...(scanStart ? { scanStart } : {}), revision: v.revision,
    enabled: v.enabled, relation: v.relation as ArrrWalletSession['relation'],
    lifecycle: v.lifecycle as ArrrWalletSession['lifecycle'], address: (v.address ?? null) as string | null })
}
