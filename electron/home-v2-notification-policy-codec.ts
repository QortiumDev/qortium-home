export const HOME_V2_NOTIFICATION_POLICY_SCHEMA = 'qortium-home-v2-notification-policy'

export type HomeV2NotificationPolicyStatus = 'available' | 'corrupt' | 'unavailable'

type HomeV2NotificationPolicySnapshotBase = {
  readonly enabled: boolean
  readonly schema: typeof HOME_V2_NOTIFICATION_POLICY_SCHEMA
  readonly version: 1
}

export type HomeV2NotificationPolicySnapshot = HomeV2NotificationPolicySnapshotBase & (
  | { readonly generation: number; readonly status: 'available' }
  | {
    readonly enabled: false
    readonly generation: null
    readonly status: Exclude<HomeV2NotificationPolicyStatus, 'available'>
  }
)

export type StoredHomeV2NotificationPolicy = {
  readonly enabled: boolean
  readonly generation: number
  readonly schema: typeof HOME_V2_NOTIFICATION_POLICY_SCHEMA
  readonly version: 1
}

export const DEFAULT_HOME_V2_NOTIFICATION_POLICY: HomeV2NotificationPolicySnapshot = Object.freeze({
  enabled: true,
  generation: 0,
  schema: HOME_V2_NOTIFICATION_POLICY_SCHEMA,
  status: 'available',
  version: 1,
})

export function failedClosedHomeV2NotificationPolicy(
  status: Exclude<HomeV2NotificationPolicyStatus, 'available'>,
): HomeV2NotificationPolicySnapshot {
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

export function parseStoredHomeV2NotificationPolicy(
  value: unknown,
): HomeV2NotificationPolicySnapshot {
  if (!isRecord(value)) throw new Error('Stored notification policy is malformed.')
  const keys = Object.keys(value).sort()
  const expected = ['enabled', 'generation', 'schema', 'version']
  if (keys.length !== expected.length || !keys.every((key, index) => key === expected[index])) {
    throw new Error('Stored notification policy has unexpected fields.')
  }
  if (
    value.schema !== HOME_V2_NOTIFICATION_POLICY_SCHEMA ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 0 ||
    typeof value.enabled !== 'boolean'
  ) {
    throw new Error('Stored notification policy is malformed.')
  }
  return Object.freeze({
    enabled: value.enabled,
    generation: value.generation as number,
    schema: HOME_V2_NOTIFICATION_POLICY_SCHEMA,
    status: 'available' as const,
    version: 1,
  })
}

export function encodeStoredHomeV2NotificationPolicy(
  snapshot: HomeV2NotificationPolicySnapshot,
): StoredHomeV2NotificationPolicy {
  if (snapshot.status !== 'available') {
    throw new Error('Unavailable notification policy cannot be stored.')
  }
  return {
    enabled: snapshot.enabled,
    generation: snapshot.generation as number,
    schema: HOME_V2_NOTIFICATION_POLICY_SCHEMA,
    version: 1,
  }
}

export type HomeV2NotificationPolicyMutation = {
  readonly enabled: boolean
  readonly expectedGeneration: number
}

export function parseHomeV2NotificationPolicyMutation(
  value: unknown,
): HomeV2NotificationPolicyMutation {
  if (!isRecord(value)) throw new Error('Notification policy mutation is required.')
  const keys = Object.keys(value).sort()
  const expected = ['enabled', 'expectedGeneration']
  if (
    keys.length !== expected.length ||
    !keys.every((key, index) => key === expected[index]) ||
    typeof value.enabled !== 'boolean' ||
    !Number.isSafeInteger(value.expectedGeneration) ||
    (value.expectedGeneration as number) < 0
  ) {
    throw new Error('Notification policy mutation is malformed.')
  }
  return {
    enabled: value.enabled,
    expectedGeneration: value.expectedGeneration as number,
  }
}
