/** Public, coin-neutral scan policy. No authority, derivation or node-selected heights here. */
export const WALLET_SCAN_START_CONTRACT = 'qortium-home-wallet-scan-start-v1' as const
export type WalletScanStart = { scanMode: 'RESUME' | 'RESTORE_FROM_HEIGHT' | 'NEW_AT_CURRENT_TIP'; restoreHeight?: number }
export function walletScanStart(request: Record<string, unknown>): WalletScanStart {
  const scanMode = request.scanMode === undefined ? 'RESUME' : request.scanMode
  if (typeof scanMode !== 'string' || !['RESUME', 'RESTORE_FROM_HEIGHT', 'NEW_AT_CURRENT_TIP'].includes(scanMode) ||
      (scanMode === 'RESTORE_FROM_HEIGHT' ? !Number.isSafeInteger(request.restoreHeight) || Number(request.restoreHeight) < 0 || Number(request.restoreHeight) > 500_000_000 : request.restoreHeight !== undefined))
    throw new Error('Invalid wallet scan start.')
  return scanMode === 'RESTORE_FROM_HEIGHT' ? { scanMode, restoreHeight: Number(request.restoreHeight) } : { scanMode: scanMode as WalletScanStart['scanMode'] }
}
export function compatibleWalletScanStart(value: unknown) {
  const v = value as Record<string, unknown> | null
  const modes = v?.scanModes
  return !!v && v.scanStartProtocolVersion === 1 && Array.isArray(modes) &&
    ['RESUME', 'RESTORE_FROM_HEIGHT', 'NEW_AT_CURRENT_TIP'].every(mode => modes.includes(mode))
}
export function walletScanPromptRows(start: WalletScanStart) {
  return [{ label: 'Wallet scan', value: start.scanMode === 'NEW_AT_CURRENT_TIP'
    ? 'New wallet: this address has NEVER received funds. Start at the current chain tip; older receipts will not be discovered.'
    : start.scanMode === 'RESTORE_FROM_HEIGHT'
    ? `Restore from block ${start.restoreHeight}. This must be before the first receipt. An existing saved wallet keeps its original scan start.`
    : 'Resume saved progress. If no checkpoint exists, use the conservative historical scan start.' }]
}
