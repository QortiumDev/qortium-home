/** Public, key-free request catalog. Resolution adds no permission or route capability. */
export const WALLET_REQUEST_CONTRACT = 'qortium-home-wallet-request-v1'
export const WALLET_REQUEST_ACTION = 'WALLET_REQUEST'

type Operation = Readonly<{ action: string; fields: readonly string[] }>
const read = (action: string, fields: readonly string[] = []): Operation => ({
  action,
  fields,
})
const common = {
  address: read('GET_USER_WALLET'),
  balance: read('GET_WALLET_BALANCE', ['verified']),
  transactions: read('GET_USER_WALLET_TRANSACTIONS'),
  send: read('SEND_COIN', [
    'recipient',
    'amount',
    'feePerByte',
    'sendMax',
    'memo',
    'acknowledgedOperationId',
  ]),
}
const catalog: Readonly<Record<string, Readonly<Record<string, Operation>>>> = {
  ARRR: {
    ...common,
    status: read('GET_ARRR_SYNC_STATUS'),
    session: read('GET_ARRR_WALLET_SESSION'),
    activate: read('ACTIVATE_ARRR_WALLET', ['expectedRevision']),
    stop: read('STOP_ARRR_SYNC'),
    start: read('START_ARRR_SYNC'),
    'send-readiness': read('GET_ARRR_SEND_READINESS'),
    'send-status': read('GET_ARRR_SEND_OPERATION'),
  },
  XMR: {
    status: read('GET_XMR_WALLET', ['passive']),
    activate: read('ACTIVATE_XMR_WALLET'),
    stop: read('STOP_XMR_WALLET'),
    'send-prepare': read('PREPARE_XMR_SEND', ['recipient', 'amount']),
    'send-commit': read('COMMIT_XMR_SEND', ['handle']),
    'send-cancel': read('CANCEL_XMR_SEND', ['handle']),
    'send-status': read('GET_XMR_SEND_STATUS', ['handle', 'passive']),
  },
  ...Object.fromEntries(
    ['BTC', 'LTC', 'DOGE', 'DGB', 'RVN', 'DASH', 'NMC', 'FIRO'].map((coin) => [
      coin,
      {
        ...common,
        servers: read('GET_CROSSCHAIN_SERVER_INFO'),
        'set-server': read('SET_CURRENT_FOREIGN_SERVER', ['server']),
      },
    ]),
  ),
}

export function resolveWalletRequest(
  request: Record<string, unknown>,
  protocol: string,
): { action: string; request: Record<string, unknown> } {
  if (
    protocol !== 'qdnRequest' ||
    request.action !== WALLET_REQUEST_ACTION ||
    Object.keys(request).some(
      (key) => !['action', 'coin', 'operation', 'parameters'].includes(key),
    ) ||
    typeof request.coin !== 'string' ||
    typeof request.operation !== 'string'
  )
    throw new Error('Invalid wallet request.')
  const operations = Object.hasOwn(catalog, request.coin)
    ? catalog[request.coin]
    : undefined
  const operation =
    operations && Object.hasOwn(operations, request.operation)
      ? operations[request.operation]
      : undefined
  if (!operation)
    throw new Error('This wallet operation is not supported for this coin.')
  const parameters = request.parameters ?? {}
  if (
    !parameters ||
    typeof parameters !== 'object' ||
    Array.isArray(parameters) ||
    Object.keys(parameters).some((key) => !operation.fields.includes(key))
  )
    throw new Error('Invalid wallet operation parameters.')
  // Canonical coin/action cannot be replaced by app-supplied parameters.
  return {
    action: operation.action,
    request: { ...parameters, action: operation.action, coin: request.coin },
  }
}

export function walletRequestAvailable(actions: readonly string[]) {
  return Object.values(catalog).some((operations) =>
    Object.values(operations).some((operation) =>
      actions.includes(operation.action),
    ),
  )
}

/** Advertise syntax only for registered coins; existing capability fields retain authority. */
export function advertiseWalletRequestContract(row: unknown): unknown {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row
  const value = row as Record<string, unknown>
  if (
    typeof value.currencyCode !== 'string' ||
    !Object.hasOwn(catalog, value.currencyCode) ||
    !value.homeWallet ||
    typeof value.homeWallet !== 'object' ||
    Array.isArray(value.homeWallet)
  )
    return row
  return {
    ...value,
    homeWallet: {
      ...value.homeWallet,
      requestContract: WALLET_REQUEST_CONTRACT,
    },
  }
}
