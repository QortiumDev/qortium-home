/** Coin-neutral display metadata. It grants neither custody nor spending authority. */
export type WalletReadStatus = {
  state: 'IDLE' | 'IN_FLIGHT' | 'OVERDUE' | 'RETRY_SCHEDULED'
  phase: 'CHECK' | 'SYNC' | 'DAEMON' | 'HISTORY' | 'SAVE' | 'BALANCE' | null
  retryAt: number | null
}
export function projectWalletReadStatus(value: unknown): WalletReadStatus | undefined {
  // Older Cores do not advertise these optional diagnostics.
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid wallet read status.')
  const v = value as Record<string, unknown>
  if (typeof v.state !== 'string' || !['IDLE', 'IN_FLIGHT', 'OVERDUE', 'RETRY_SCHEDULED'].includes(String(v.state)) ||
      !(v.phase === null || (typeof v.phase === 'string' && ['CHECK', 'SYNC', 'DAEMON', 'HISTORY', 'SAVE', 'BALANCE'].includes(v.phase))) ||
      !(v.retryAt === null || (Number.isSafeInteger(v.retryAt) && (v.retryAt as number) >= 0 && (v.retryAt as number) <= 8_640_000_000_000_000)))
    throw new Error('Invalid wallet read status.')
  const working = v.state === 'IN_FLIGHT' || v.state === 'OVERDUE'
  if ((!working && v.phase !== null) || (v.state === 'RETRY_SCHEDULED' ? v.retryAt === null : v.retryAt !== null))
    throw new Error('Invalid wallet read status.')
  return { state: v.state as WalletReadStatus['state'], phase: v.phase as WalletReadStatus['phase'], retryAt: v.retryAt as number | null }
}
