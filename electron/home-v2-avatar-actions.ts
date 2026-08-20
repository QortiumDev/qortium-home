import {
  buildAccountAvatarPath,
  buildAvatarInfoPath,
  buildAvatarResourcePath,
  buildGroupAvatarPath,
  buildLegacyAccountAvatarResource,
  buildLegacyGroupAvatarResource,
  getAvatarDescriptor,
  getGroupAvatarGroupId,
  type AvatarDescriptor,
  type AvatarSource,
} from './qdn-group-avatar-input.js'
import {
  isHomeV2AppRecord,
  normalizeHomeV2Address,
  normalizeHomeV2AvatarMaxBytes,
  type HomeV2AppNetwork,
} from './home-v2-app-actions.js'

export type HomeV2AvatarAction = 'FETCH_ACCOUNT_AVATAR' | 'FETCH_GROUP_AVATAR'

export type HomeV2AvatarBinaryResult =
  | {
      readonly body: string
      readonly contentLength: number
      readonly contentType: string
      readonly descriptor?: AvatarDescriptor | null
      readonly status: 'ready'
    }
  | {
      readonly descriptor?: AvatarDescriptor | null
      readonly retryAfterSeconds: number | null
      readonly status: 'pending'
    }
  | { readonly status: 'missing' }
  | { readonly message: string; readonly status: 'unavailable' }

export interface HomeV2AvatarActionDependencies {
  readAvatar(path: string, legacyAsync: boolean): Promise<HomeV2AvatarBinaryResult>
  readJson(path: string): Promise<{ readonly data: unknown; readonly status: number }>
}

type AvatarTarget =
  | { readonly address: string; readonly kind: 'account' }
  | { readonly groupId: number; readonly kind: 'group' }

function stringField(value: unknown, key: string) {
  if (!isHomeV2AppRecord(value)) return null
  const field = value[key]
  return typeof field === 'string' && field.trim() ? field.trim() : null
}

function firstOwnedName(value: unknown) {
  if (!Array.isArray(value)) return null
  return value.map((entry) => stringField(entry, 'name')).find(Boolean) ?? null
}

function parsePointer(value: unknown) {
  if (!isHomeV2AppRecord(value)) return null
  return getAvatarDescriptor({
    identifier: stringField(value, 'identifier'),
    name: stringField(value, 'name'),
    service: stringField(value, 'service'),
  })
}

async function readJsonOrNull(
  dependencies: HomeV2AvatarActionDependencies,
  path: string,
  label: string,
) {
  const result = await dependencies.readJson(path)
  if (result.status === 404) return null
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${label} returned HTTP ${result.status}.`)
  }
  return result.data
}

async function resolvePrimaryName(
  dependencies: HomeV2AvatarActionDependencies,
  address: string,
) {
  const primary = await readJsonOrNull(
    dependencies,
    `/names/primary/${encodeURIComponent(address)}`,
    'Primary-name lookup',
  )
  const primaryName = stringField(primary, 'name')
  if (primaryName) return primaryName

  const owned = await readJsonOrNull(
    dependencies,
    `/names/address/${encodeURIComponent(address)}?limit=0`,
    'Account-name lookup',
  )
  return firstOwnedName(owned)
}

function requireAvatarName(value: string | null, target: 'Account' | 'Group') {
  if (!value) throw new Error(`${target} avatar is not set.`)
  if (
    value.length > 128
    || value === '.'
    || value === '..'
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${target} avatar name was invalid.`)
  }
  return value
}

function normalizedTarget(action: HomeV2AvatarAction, request: Record<string, unknown>): AvatarTarget {
  if (action === 'FETCH_ACCOUNT_AVATAR') {
    return { address: normalizeHomeV2Address(request.address), kind: 'account' }
  }
  return {
    groupId: getGroupAvatarGroupId(request.groupId ?? request.txGroupId),
    kind: 'group',
  }
}

async function resolveLegacyGroupResource(
  dependencies: HomeV2AvatarActionDependencies,
  groupId: number,
) {
  const groupData = await readJsonOrNull(
    dependencies,
    `/groups/${encodeURIComponent(String(groupId))}`,
    'Group lookup',
  )
  if (!isHomeV2AppRecord(groupData)) throw new Error('Group was not found.')
  const returnedGroupId = Number(groupData.groupId)
  if (Number.isSafeInteger(returnedGroupId) && returnedGroupId !== groupId) {
    throw new Error('Group lookup returned a different group.')
  }
  const owner = stringField(groupData, 'owner')
  const ownerPrimaryName = stringField(groupData, 'ownerPrimaryName')
    ?? (owner ? await resolvePrimaryName(dependencies, normalizeHomeV2Address(owner)) : null)
  return buildLegacyGroupAvatarResource(requireAvatarName(ownerPrimaryName, 'Group'), groupId)
}

function translateResult(
  network: HomeV2AppNetwork,
  target: AvatarTarget,
  source: AvatarSource,
  descriptor: AvatarDescriptor | null,
  result: HomeV2AvatarBinaryResult,
  maxBytes: number,
) {
  const identity = target.kind === 'account'
    ? { address: target.address }
    : { groupId: target.groupId }
  const effectiveDescriptor = source === 'POINTER' && 'descriptor' in result
    ? result.descriptor ?? descriptor
    : descriptor
  if (result.status === 'pending' || (source === 'LEGACY' && result.status === 'missing')) {
    return {
      ...identity,
      descriptor: effectiveDescriptor,
      network,
      retryAfterSeconds: result.status === 'pending' ? result.retryAfterSeconds : 2,
      source,
      status: 'PENDING' as const,
    }
  }
  if (result.status !== 'ready') {
    throw new Error(
      result.status === 'unavailable'
        ? result.message
        : `${target.kind === 'account' ? 'Account' : 'Group'} avatar is not set.`,
    )
  }
  if (result.contentLength > maxBytes) {
    throw new Error(
      `${target.kind === 'account' ? 'Account' : 'Group'} avatar exceeded the requested size limit.`,
    )
  }
  return {
    ...identity,
    body: result.body,
    contentLength: result.contentLength,
    contentType: result.contentType,
    descriptor: effectiveDescriptor,
    encoding: 'base64' as const,
    network,
    source,
  }
}

export async function fetchHomeV2AvatarAction(
  network: HomeV2AppNetwork,
  action: HomeV2AvatarAction,
  request: Record<string, unknown>,
  dependencies: HomeV2AvatarActionDependencies,
) {
  const target = normalizedTarget(action, request)
  const maxBytes = normalizeHomeV2AvatarMaxBytes(request.maxBytes)

  if (network === 'qortium') {
    const pointerInfoPath = buildAvatarInfoPath(
      target.kind,
      target.kind === 'account' ? target.address : target.groupId,
    )
    const pointerInfo = await dependencies.readJson(pointerInfoPath)
    if (pointerInfo.status !== 404) {
      if (pointerInfo.status < 200 || pointerInfo.status >= 300) {
        throw new Error(
          `${target.kind === 'account' ? 'Account' : 'Group'} avatar pointer lookup returned HTTP ${pointerInfo.status}.`,
        )
      }
      const descriptor = parsePointer(pointerInfo.data)
      if (!descriptor) throw new Error('Avatar pointer metadata was invalid.')
      const path = target.kind === 'account'
        ? buildAccountAvatarPath(target.address)
        : buildGroupAvatarPath(target.groupId)
      return translateResult(
        network,
        target,
        'POINTER',
        descriptor,
        await dependencies.readAvatar(path, false),
        maxBytes,
      )
    }
  }

  const resource = target.kind === 'account'
    ? buildLegacyAccountAvatarResource(
        requireAvatarName(await resolvePrimaryName(dependencies, target.address), 'Account'),
        network === 'qortal' ? 'qortal-hub' : 'qortium',
      )
    : await resolveLegacyGroupResource(dependencies, target.groupId)

  return translateResult(
    network,
    target,
    'LEGACY',
    null,
    await dependencies.readAvatar(buildAvatarResourcePath(resource), true),
    maxBytes,
  )
}
