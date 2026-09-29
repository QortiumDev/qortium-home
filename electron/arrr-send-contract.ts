/** Versioned desktop custody send contract. No secrets or Node imports. */
export const ARRR_SEND_CONTRACT = 'qortium-home-arrr-send-v2' as const
export const ARRR_SEND_ROWS = [
  'Coin',
  'Network',
  'Recipient',
  'Amount',
  'Fee',
  'Total debit',
  'Memo',
  'Previous payment',
] as const
export const ARRR_SEND_READ_ACTIONS = ['GET_ARRR_SEND_READINESS', 'GET_ARRR_SEND_OPERATION'] as const
export type ArrrSendState = 'ACCEPTED' | 'NATIVE_STARTED' | 'BROADCAST' | 'FAILED' | 'UNRESOLVED'
export type ArrrSendOperation = Readonly<{
  operationId: string
  idempotencyKey: string
  walletIdentityHash: string
  network: string
  state: ArrrSendState
  txid: string | null
  reason: string | null
  feeAtomic: '10000'
  feePolicy: 'FIXED'
  sendProtocolVersion: 2
  resolutionRequired: boolean
}>
export function compatibleArrrSendContract(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.sendProtocolVersion === 2 &&
    v.network === 'MAIN' &&
    v.feePolicy === 'FIXED' &&
    v.feeAtomic === '10000' &&
    v.amountDecimals === 8 &&
    v.maxMemoBytes === 512 &&
    Array.isArray(v.recipientAddressTypes) &&
    v.recipientAddressTypes.length === 1 &&
    v.recipientAddressTypes[0] === 'sapling'
  )
}

export function arrrSendApprovalSummary(appTitle: string) {
  return `${appTitle} wants to send ARRR on Pirate Chain mainnet. Home sends this account’s ARRR spending key to your trusted Core, which builds, signs and broadcasts this one payment. The fixed fee is 0.0001 ARRR. An uncertain outcome blocks further spending from this wallet. Review the recipient, amount and any previous payment below.`
}
