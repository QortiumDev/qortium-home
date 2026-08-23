export const HOME_V2_NOTIFICATION_POLICY_SCHEMA =
  'qortium-home-v2-notification-policy' as const
export const HOME_V2_NOTIFICATION_POLICY_KEY =
  'qortium-home-v2-notification-policy'
export const LEGACY_DISPLAY_SETTINGS_KEY = 'qortium-home-display-settings'

export type HomeV2NotificationPolicyStatus =
  | 'available'
  | 'corrupt'
  | 'unavailable'

export interface HomeV2NotificationPolicyState {
  readonly enabled: boolean
  readonly generation: number | null
  readonly schema: typeof HOME_V2_NOTIFICATION_POLICY_SCHEMA
  readonly status: HomeV2NotificationPolicyStatus
  readonly version: 1
}

export interface HomeV2NotificationPolicyAdapter {
  get(): Promise<unknown>
  set(request: {
    readonly enabled: boolean
    readonly expectedGeneration: number
  }): Promise<unknown>
  subscribe?(listener: () => void): () => void
}

export interface HomeV2NotificationPolicyClient {
  get(): Promise<HomeV2NotificationPolicyState>
  set(request: {
    readonly enabled: boolean
    readonly expectedGeneration: number
  }): Promise<HomeV2NotificationPolicyState>
  subscribe(listener: () => void): () => void
}

export interface PortableHomeV2NotificationPolicyDependencies {
  getPreference(key: string): Promise<string | null>
  setPreference(key: string, value: string): Promise<void>
}

export function failedClosedHomeV2NotificationPolicyState(
  status: Exclude<HomeV2NotificationPolicyStatus, 'available'>,
): HomeV2NotificationPolicyState {
  return Object.freeze({
    enabled: false,
    generation: null,
    schema: HOME_V2_NOTIFICATION_POLICY_SCHEMA,
    status,
    version: 1,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index])
}

export function parseHomeV2NotificationPolicyState(
  value: unknown,
): HomeV2NotificationPolicyState {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['enabled', 'generation', 'schema', 'status', 'version']) ||
    value.schema !== HOME_V2_NOTIFICATION_POLICY_SCHEMA ||
    value.version !== 1 ||
    (value.status !== 'available' &&
      value.status !== 'corrupt' &&
      value.status !== 'unavailable') ||
    typeof value.enabled !== 'boolean' ||
    (value.status === 'available'
      ? !Number.isSafeInteger(value.generation) || Number(value.generation) < 0
      : value.generation !== null) ||
    (value.status !== 'available' && value.enabled !== false)
  ) {
    throw new Error('Home 2 notification policy state was malformed.')
  }
  return Object.freeze({
    enabled: value.enabled,
    generation: value.generation as number | null,
    schema: HOME_V2_NOTIFICATION_POLICY_SCHEMA,
    status: value.status,
    version: 1 as const,
  })
}

function parseStoredPolicy(raw: string): HomeV2NotificationPolicyState {
  const value = JSON.parse(raw) as unknown
  if (
    !isRecord(value) ||
    !exactKeys(value, ['enabled', 'generation', 'schema', 'version']) ||
    value.schema !== HOME_V2_NOTIFICATION_POLICY_SCHEMA ||
    value.version !== 1 ||
    typeof value.enabled !== 'boolean' ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 0
  ) {
    throw new Error('Stored Home 2 notification policy was malformed.')
  }
  return parseHomeV2NotificationPolicyState({
    ...value,
    status: 'available',
  })
}

function legacyNotificationsEnabled(raw: string | null) {
  if (!raw) return true
  try {
    const value = JSON.parse(raw) as unknown
    return !(isRecord(value) && value.appNotifications === false)
  } catch {
    return true
  }
}

export function createPortableHomeV2NotificationPolicyAdapter(
  dependencies: PortableHomeV2NotificationPolicyDependencies,
): HomeV2NotificationPolicyAdapter {
  const listeners = new Set<() => void>()
  let mutationQueue = Promise.resolve()

  const read = async (): Promise<HomeV2NotificationPolicyState> => {
    let raw: string | null
    try {
      raw = await dependencies.getPreference(HOME_V2_NOTIFICATION_POLICY_KEY)
    } catch {
      return failedClosedHomeV2NotificationPolicyState('unavailable')
    }
    if (raw !== null) {
      try {
        return parseStoredPolicy(raw)
      } catch {
        return failedClosedHomeV2NotificationPolicyState('corrupt')
      }
    }
    try {
      const enabled = legacyNotificationsEnabled(
        await dependencies.getPreference(LEGACY_DISPLAY_SETTINGS_KEY),
      )
      const initial = {
        enabled,
        generation: 0,
        schema: HOME_V2_NOTIFICATION_POLICY_SCHEMA,
        version: 1,
      } as const
      await dependencies.setPreference(
        HOME_V2_NOTIFICATION_POLICY_KEY,
        JSON.stringify(initial),
      )
      return parseStoredPolicy(JSON.stringify(initial))
    } catch {
      return failedClosedHomeV2NotificationPolicyState('unavailable')
    }
  }

  return {
    get: read,
    set(request) {
      const operation = mutationQueue.then(async () => {
        if (
          typeof request.enabled !== 'boolean' ||
          !Number.isSafeInteger(request.expectedGeneration) ||
          request.expectedGeneration < 0
        ) throw new Error('Home 2 notification policy mutation was malformed.')
        const current = await read()
        if (current.status !== 'available' || current.generation === null) {
          throw new Error('Home 2 notification policy is unavailable.')
        }
        if (current.generation !== request.expectedGeneration) {
          throw Object.assign(
            new Error('Notification settings changed; refresh and try again.'),
            { code: 'HOME_DATA_STALE' },
          )
        }
        if (current.enabled === request.enabled) return current
        if (current.generation >= Number.MAX_SAFE_INTEGER) {
          throw new Error('Home 2 notification policy generation is exhausted.')
        }
        const next = {
          enabled: request.enabled,
          generation: current.generation + 1,
          schema: HOME_V2_NOTIFICATION_POLICY_SCHEMA,
          version: 1,
        } as const
        await dependencies.setPreference(
          HOME_V2_NOTIFICATION_POLICY_KEY,
          JSON.stringify(next),
        )
        const state = parseStoredPolicy(JSON.stringify(next))
        for (const listener of listeners) listener()
        return state
      })
      mutationQueue = operation.then(() => undefined, () => undefined)
      return operation
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function createHomeV2NotificationPolicyClient(
  adapter: HomeV2NotificationPolicyAdapter,
): HomeV2NotificationPolicyClient {
  return {
    async get() {
      return parseHomeV2NotificationPolicyState(await adapter.get())
    },
    async set(request) {
      return parseHomeV2NotificationPolicyState(await adapter.set(request))
    },
    subscribe(listener) {
      return adapter.subscribe?.(listener) ?? (() => undefined)
    },
  }
}

type WindowWithHomeV2NotificationPolicy = Window & {
  readonly homeV2NotificationPolicy?: HomeV2NotificationPolicyAdapter
}

export function resolveHomeV2NotificationPolicyClient(
  injectedAdapter?: HomeV2NotificationPolicyAdapter | null,
) {
  const adapter = injectedAdapter === undefined && typeof window !== 'undefined'
    ? (window as WindowWithHomeV2NotificationPolicy).homeV2NotificationPolicy
    : injectedAdapter
  return adapter ? createHomeV2NotificationPolicyClient(adapter) : null
}
