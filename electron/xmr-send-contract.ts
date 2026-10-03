/** Shared public contract. No authority or Node dependencies. */
export const XMR_SEND_CONTRACT = 'qortium-home-xmr-send-v1' as const
export const XMR_SEND_ACTIONS = ['PREPARE_XMR_SEND', 'COMMIT_XMR_SEND', 'CANCEL_XMR_SEND', 'GET_XMR_SEND_STATUS'] as const
export type XmrSendAction = typeof XMR_SEND_ACTIONS[number]
export const isXmrSendAction = (v: string): v is XmrSendAction => (XMR_SEND_ACTIONS as readonly string[]).includes(v)
export const XMR_SEND_ROWS = ['Coin', 'Network', 'Recipient', 'Amount', 'Fee', 'Total debit', 'Fee policy', 'Recovery'] as const
export function compatibleXmrSendCore(value: unknown) {
  const v = value as Record<string, unknown> | null
  return !!v && v.protocolVersion === 1 && v.derivationVersion === 1 && v.enabled === true && v.platformSupported === true && v.send === true && v.sendProtocolVersion === 1 && v.feePolicy === 'NATIVE_NORMAL' && v.decimals === 12 && v.network === 'mainnet' && v.localCustodyOnly === true
}
export function formatXmrAtomic(value: string) {
  if (!/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n) throw Error('Invalid XMR amount.')
  const n = BigInt(value)
  return `${n / 1000000000000n}.${String(n % 1000000000000n).padStart(12, '0')}`
}
export function xmrSendSummary(app: string) {
  return `${app} wants to send XMR on Monero mainnet. Your local Core prepared this exact recipient, amount and native network fee. Approving relays this one transaction. An uncertain outcome must be checked, never automatically retried. Further spending waits for ten confirmations and unlocked inputs.`
}
