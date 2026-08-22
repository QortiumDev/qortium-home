import type { IpcMainInvokeEvent } from 'electron'
import type { StoredHomeV2AppUpdateSettings } from './home-v2-app-update-settings-codec.js'

export type HomeV2AppUpdateSettingsState = StoredHomeV2AppUpdateSettings & {
  readonly revision: 1
  readonly schema: 'home-v2-app-update-settings'
}

export type HomeV2AppUpdateAutomaticClaim = Omit<HomeV2AppUpdateSettingsState, 'schema'> & {
  readonly claimed: boolean
  readonly schema: 'home-v2-app-update-automatic-claim'
}

type Dependencies = {
  readonly read: () => Promise<StoredHomeV2AppUpdateSettings>
  readonly write: (
    expectedGeneration: number,
    settings: Omit<StoredHomeV2AppUpdateSettings, 'generation'>,
  ) => Promise<StoredHomeV2AppUpdateSettings>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function response(settings: StoredHomeV2AppUpdateSettings): HomeV2AppUpdateSettingsState {
  return { ...settings, revision: 1, schema: 'home-v2-app-update-settings' }
}

function parseGet(value: unknown) {
  if (
    !exact(value, ['revision', 'schema']) ||
    value.schema !== 'home-v2-app-update-settings-get-request' ||
    value.revision !== 1
  ) throw new Error('An exact app update settings request is required.')
}

function parseClaim(value: unknown) {
  if (
    !exact(value, ['revision', 'schema']) ||
    value.schema !== 'home-v2-app-update-automatic-claim-request' ||
    value.revision !== 1
  ) throw new Error('An exact automatic app update claim is required.')
}

function parseSet(value: unknown) {
  if (
    !exact(value, ['expectedGeneration', 'revision', 'schema', 'settings']) ||
    value.schema !== 'home-v2-app-update-settings-set-request' ||
    value.revision !== 1 ||
    !Number.isSafeInteger(value.expectedGeneration) ||
    (value.expectedGeneration as number) < 0 ||
    !exact(value.settings, ['homeUpdatePolicy', 'releaseChannel'])
  ) throw new Error('An exact app update settings replacement is required.')
  const homeUpdatePolicy = value.settings.homeUpdatePolicy
  const releaseChannel = value.settings.releaseChannel
  if (
    (homeUpdatePolicy !== 'off' && homeUpdatePolicy !== 'notify' && homeUpdatePolicy !== 'auto-download') ||
    (releaseChannel !== 'stable' && releaseChannel !== 'prerelease')
  ) throw new Error('Choose valid app update settings.')
  return {
    expectedGeneration: value.expectedGeneration as number,
    settings: {
      homeUpdatePolicy: homeUpdatePolicy as StoredHomeV2AppUpdateSettings['homeUpdatePolicy'],
      releaseChannel: releaseChannel as StoredHomeV2AppUpdateSettings['releaseChannel'],
    },
  }
}

export function createHomeV2AppUpdateSettingsService(dependencies: Dependencies) {
  const automaticClaims = new Set<number>()
  return {
    async claimAutomatic(value: unknown): Promise<HomeV2AppUpdateAutomaticClaim> {
      parseClaim(value)
      const settings = await dependencies.read()
      const claimed = settings.homeUpdatePolicy !== 'off' && !automaticClaims.has(settings.generation)
      if (claimed) automaticClaims.add(settings.generation)
      return {
        ...settings,
        claimed,
        revision: 1,
        schema: 'home-v2-app-update-automatic-claim',
      }
    },
    async get(value: unknown) {
      parseGet(value)
      return response(await dependencies.read())
    },
    async set(value: unknown) {
      const request = parseSet(value)
      return response(await dependencies.write(request.expectedGeneration, request.settings))
    },
  }
}

export function createAuthorizedHomeV2AppUpdateSettingsHandlers(
  assertAuthorized: (event: IpcMainInvokeEvent) => void,
  service: ReturnType<typeof createHomeV2AppUpdateSettingsService>,
) {
  return {
    claimAutomatic(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.claimAutomatic(value)
    },
    get(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.get(value)
    },
    set(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.set(value)
    },
  }
}
