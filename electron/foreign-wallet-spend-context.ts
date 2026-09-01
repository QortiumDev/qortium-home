import type { ForeignWalletWatchInput } from './foreign-wallet-transaction.js'
import type { ForeignWalletCoin } from './foreign-wallets.js'

export type ForeignWalletSpendContext = Readonly<{
  activeNetwork: string
  blockchain: string
  chainId: string
  coin: ForeignWalletCoin
  minimumNonDustOutput: bigint
  recommendedFeePerByte: bigint
  tipHeight: number
  transactionVersion: number
  utxos: readonly ForeignWalletWatchInput[]
}>

const MAX_INPUTS = 1_000
const MAX_RAW_TRANSACTION_BYTES = 1_000_000
const MAX_TOTAL_RAW_TRANSACTION_BYTES = 8_000_000
const MAX_ATOMIC = 0xffffffffffffffffn

export const FOREIGN_WALLET_MAINNET_CHAIN_IDS: Readonly<Record<ForeignWalletCoin, string>> = Object.freeze({
  BTC: 'bip122:000000000019d6689c085ae165831e93',
  DASH: 'bip122:00000ffd590b1485b3caadc19b22e637',
  DGB: 'bip122:7497ea1b465eb39f1c8f507bc877078f',
  DOGE: 'bip122:1a91e3dace36e2be3bf030a65679fe82',
  FIRO: 'bip122:4381deb85b1b2c9843c222944b616d99',
  LTC: 'bip122:12a765e31ffd4059bada1e25190f6e98',
  NMC: 'bip122:000000000062b72c5e2ceb45fbc8587e',
  RVN: 'bip122:0000006b444bc2f2ffe627be9d9e7e7a',
})

const FOREIGN_WALLET_BLOCKCHAINS: Readonly<Record<ForeignWalletCoin, string>> = Object.freeze({
  BTC: 'BITCOIN',
  DASH: 'DASH',
  DGB: 'DIGIBYTE',
  DOGE: 'DOGECOIN',
  FIRO: 'FIRO',
  LTC: 'LITECOIN',
  NMC: 'NAMECOIN',
  RVN: 'RAVENCOIN',
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value.trim()
}

function safePositiveInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`${label} is invalid.`)
  return Number(value)
}

function safeUint32(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 0xffffffff) {
    throw new Error(`${label} is invalid.`)
  }
  return Number(value)
}

function positiveAtomic(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label} is invalid.`)
  const atomic = BigInt(value)
  if (atomic > MAX_ATOMIC) throw new Error(`${label} is invalid.`)
  return atomic
}

function canonicalHex(value: unknown, bytes: number, label: string) {
  const hex = boundedString(value, label, bytes * 2).toLowerCase()
  if (hex.length !== bytes * 2 || !/^[0-9a-f]+$/.test(hex)) throw new Error(`${label} is invalid.`)
  return hex
}

export function normalizeBip122ChainId(value: unknown, label = 'Foreign wallet chain ID') {
  const chainId = boundedString(value, label, 39).toLowerCase()
  if (!/^bip122:[0-9a-f]{32}$/.test(chainId)) throw new Error(`${label} is invalid.`)
  return chainId
}

export function getForeignWalletMainnetChainId(coin: ForeignWalletCoin) {
  return FOREIGN_WALLET_MAINNET_CHAIN_IDS[coin]
}

export function buildForeignWalletSpendContextRequest(xpub58: unknown, coin: ForeignWalletCoin) {
  const xpub = boundedString(xpub58, 'Foreign wallet extended public key', 128)
  if (!/^[1-9A-HJ-NP-Za-km-z]{100,128}$/.test(xpub)) {
    throw new Error('Foreign wallet extended public key is invalid.')
  }
  return Object.freeze({
    expectedChainId: getForeignWalletMainnetChainId(coin),
    xpub58: xpub,
  })
}

export function normalizeForeignWalletSpendContext(
  value: unknown,
  coin: ForeignWalletCoin,
): ForeignWalletSpendContext {
  if (!isRecord(value)) throw new Error('Foreign wallet spend context is invalid.')
  const expectedChainId = getForeignWalletMainnetChainId(coin)
  const chainId = normalizeBip122ChainId(value.chainId)
  if (chainId !== expectedChainId) throw new Error('Foreign wallet spend context is for a different chain.')
  if (value.version !== 1 || value.confirmedOnly !== true || value.transactionFormat !== 'LEGACY'
    || value.transactionVersion !== 1 || value.sighashType !== 1
    || value.sequence !== 0xffffffff || value.lockTime !== 0) {
    throw new Error('Foreign wallet spend context uses unsupported transaction rules.')
  }
  const currencyCode = boundedString(value.currencyCode, 'Foreign wallet currency code', 16).toUpperCase()
  if (currencyCode !== coin) throw new Error('Foreign wallet spend context is for a different coin.')
  const blockchain = boundedString(value.blockchain, 'Foreign wallet blockchain', 64).toUpperCase()
  if (blockchain !== FOREIGN_WALLET_BLOCKCHAINS[coin]) {
    throw new Error('Foreign wallet spend context is for a different blockchain.')
  }
  const activeNetwork = boundedString(value.activeNetwork, 'Foreign wallet active network', 64)
  if (activeNetwork.toUpperCase() !== 'MAIN') {
    throw new Error('Foreign wallet spend context is not on the supported main network.')
  }
  const tipHeight = safePositiveInteger(value.tipHeight, 'Foreign wallet tip height')
  const minimumNonDustOutput = positiveAtomic(value.minimumNonDustOutput, 'Foreign wallet minimum output')
  const recommendedFeePerByte = positiveAtomic(value.recommendedFeePerByte, 'Foreign wallet recommended fee')

  if (!isRecord(value.previousTransactions)) {
    throw new Error('Foreign wallet previous transactions are invalid.')
  }
  const previousTransactions = new Map<string, string>()
  let totalRawBytes = 0
  for (const [rawHash, rawHexValue] of Object.entries(value.previousTransactions)) {
    const txHash = canonicalHex(rawHash, 32, 'Foreign wallet previous transaction hash')
    if (previousTransactions.has(txHash)) throw new Error('Foreign wallet previous transaction is duplicated.')
    if (typeof rawHexValue !== 'string' || rawHexValue.length === 0 || rawHexValue.length % 2 !== 0
      || rawHexValue.length > MAX_RAW_TRANSACTION_BYTES * 2 || !/^[0-9a-fA-F]+$/.test(rawHexValue)) {
      throw new Error('Foreign wallet previous transaction is invalid.')
    }
    totalRawBytes += rawHexValue.length / 2
    if (totalRawBytes > MAX_TOTAL_RAW_TRANSACTION_BYTES) {
      throw new Error('Foreign wallet previous transactions exceed the safe limit.')
    }
    previousTransactions.set(txHash, rawHexValue.toLowerCase())
  }

  if (!Array.isArray(value.utxos) || value.utxos.length > MAX_INPUTS) {
    throw new Error('Foreign wallet spendable outputs are invalid.')
  }
  const referencedTransactions = new Set<string>()
  const seenOutpoints = new Set<string>()
  const utxos = value.utxos.map((rawUtxo): ForeignWalletWatchInput => {
    if (!isRecord(rawUtxo)) throw new Error('Foreign wallet spendable output is invalid.')
    const txHash = canonicalHex(rawUtxo.txHash, 32, 'Foreign wallet input transaction hash')
    const txPos = safeUint32(rawUtxo.outputIndex, 'Foreign wallet input position')
    const outpoint = `${txHash}:${txPos}`
    if (seenOutpoints.has(outpoint)) throw new Error('Foreign wallet spend context contains a duplicate input.')
    seenOutpoints.add(outpoint)
    const height = safePositiveInteger(rawUtxo.height, 'Foreign wallet input height')
    if (height > tipHeight) throw new Error('Foreign wallet input height exceeds the reported tip.')
    if (!Array.isArray(rawUtxo.path) || rawUtxo.path.length !== 2
      || (rawUtxo.path[0] !== 0 && rawUtxo.path[0] !== 1)
      || !Number.isSafeInteger(rawUtxo.path[1]) || Number(rawUtxo.path[1]) < 0
      || Number(rawUtxo.path[1]) > 0x7fffffff) {
      throw new Error('Foreign wallet input derivation path is invalid.')
    }
    const path = boundedString(rawUtxo.pathAsString, 'Foreign wallet input derivation path', 32).toUpperCase()
    const expectedPath = `M/${rawUtxo.path[0]}/${rawUtxo.path[1]}`
    if (path !== expectedPath) throw new Error('Foreign wallet input derivation paths do not match.')
    const previousTransactionHex = previousTransactions.get(txHash)
    if (!previousTransactionHex) throw new Error('Foreign wallet input is missing its previous transaction.')
    referencedTransactions.add(txHash)
    return Object.freeze({
      address: boundedString(rawUtxo.address, 'Foreign wallet input address', 128),
      height,
      path,
      previousTransactionHex,
      scriptPubKey: canonicalHex(rawUtxo.scriptPubKeyHex, 25, 'Foreign wallet input script'),
      txHash,
      txPos,
      value: positiveAtomic(rawUtxo.value, 'Foreign wallet input value'),
    })
  })
  if (previousTransactions.size !== referencedTransactions.size) {
    throw new Error('Foreign wallet spend context contains an unreferenced previous transaction.')
  }

  return Object.freeze({
    activeNetwork,
    blockchain,
    chainId,
    coin,
    minimumNonDustOutput,
    recommendedFeePerByte,
    tipHeight,
    transactionVersion: 1,
    utxos: Object.freeze(utxos),
  })
}
