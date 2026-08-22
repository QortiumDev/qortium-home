export type HomeV2CoreUpdatePolicy = 'install' | 'notify' | 'off'

export type HomeV2CoreUpdatePolicySettings = {
  readonly coreUpdatePolicy: HomeV2CoreUpdatePolicy
  readonly generation: number
  readonly javaUpdatePolicy: HomeV2CoreUpdatePolicy
  readonly storageIssue: 'invalid' | null
}

export type WritableHomeV2CoreUpdatePolicySettings = Pick<
  HomeV2CoreUpdatePolicySettings,
  'coreUpdatePolicy' | 'javaUpdatePolicy'
>

export const DEFAULT_HOME_V2_CORE_UPDATE_POLICY_SETTINGS: HomeV2CoreUpdatePolicySettings = {
  coreUpdatePolicy: 'notify',
  generation: 0,
  javaUpdatePolicy: 'notify',
  storageIssue: null,
}

export const FAILED_CLOSED_HOME_V2_CORE_UPDATE_POLICY_SETTINGS: HomeV2CoreUpdatePolicySettings = {
  coreUpdatePolicy: 'off',
  generation: 0,
  javaUpdatePolicy: 'off',
  storageIssue: 'invalid',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isPolicy(value: unknown): value is HomeV2CoreUpdatePolicy {
  return value === 'install' || value === 'notify' || value === 'off'
}

export function parseStoredHomeV2CoreUpdatePolicySettings(value: unknown): HomeV2CoreUpdatePolicySettings {
  if (!isRecord(value)) throw new Error('Stored Core update settings are malformed.')
  const keys = Object.keys(value).sort()
  const expected = [
    'coreUpdatePolicy',
    'generation',
    'javaUpdatePolicy',
    'schema',
    'version',
  ]
  if (keys.length !== expected.length || !keys.every((key, index) => key === expected[index])) {
    throw new Error('Stored Core update settings have unexpected fields.')
  }
  if (
    value.schema !== 'qortium-home-v2-core-update-policy' ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 0 ||
    (value.generation as number) >= Number.MAX_SAFE_INTEGER ||
    !isPolicy(value.coreUpdatePolicy) ||
    !isPolicy(value.javaUpdatePolicy)
  ) throw new Error('Stored Core update settings are malformed.')

  return {
    coreUpdatePolicy: value.coreUpdatePolicy,
    generation: value.generation as number,
    javaUpdatePolicy: value.javaUpdatePolicy,
    storageIssue: null,
  }
}

export function parseLegacyCoreUpdateSettings(value: unknown): WritableHomeV2CoreUpdatePolicySettings | null {
  if (!isRecord(value)) {
    return null
  }

  const keys = Object.keys(value).sort()
  const expected = ['coreUpdatePolicy', 'javaUpdatePolicy']
  if (
    keys.length !== expected.length ||
    !keys.every((key, index) => key === expected[index]) ||
    !isPolicy(value.coreUpdatePolicy) ||
    !isPolicy(value.javaUpdatePolicy)
  ) return null

  return {
    coreUpdatePolicy: value.coreUpdatePolicy,
    javaUpdatePolicy: value.javaUpdatePolicy,
  }
}

export function parseLegacyJavaAutoUpdateSettings(value: unknown): HomeV2CoreUpdatePolicy | null {
  if (!isRecord(value) || Array.isArray(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== 'autoUpdate' || typeof value.autoUpdate !== 'boolean') {
    return null
  }
  return value.autoUpdate ? 'install' : 'notify'
}

export function validateWritableHomeV2CoreUpdatePolicySettings(
  value: unknown,
): WritableHomeV2CoreUpdatePolicySettings {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
    !isPolicy(value.coreUpdatePolicy) || !isPolicy(value.javaUpdatePolicy)) {
    throw new Error('Choose valid Core and Java update policies.')
  }
  return {
    coreUpdatePolicy: value.coreUpdatePolicy,
    javaUpdatePolicy: value.javaUpdatePolicy,
  }
}
