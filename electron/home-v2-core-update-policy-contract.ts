import type { IpcMainInvokeEvent } from 'electron'
import {
  idleHomeV2CoreUpdateActivity,
  type HomeV2CoreUpdateActivity,
} from './home-v2-core-update-policy-engine.js'
import type {
  HomeV2CoreUpdatePolicy,
  HomeV2CoreUpdatePolicySettings,
  WritableHomeV2CoreUpdatePolicySettings,
} from './home-v2-core-update-policy-codec.js'
import { homeV2CoreOperationCoordinator } from './home-v2-core-operation-coordinator.js'

export type HomeV2CoreUpdatePolicyState = Readonly<{
  activity: HomeV2CoreUpdateActivity
  coreUpdatePolicy: HomeV2CoreUpdatePolicy
  generation: number
  javaUpdatePolicy: HomeV2CoreUpdatePolicy
  revision: 1
  schema: 'home-v2-core-update-policy'
  settingsIssue: 'settings-unavailable' | null
}>

export type HomeV2CoreUpdatePolicySetResult = Readonly<{
  outcome: 'conflict' | 'saved'
  revision: 1
  schema: 'home-v2-core-update-policy-set-result'
  state: HomeV2CoreUpdatePolicyState
}>

type Dependencies = Readonly<{
  getActivity(): HomeV2CoreUpdateActivity
  read(): Promise<HomeV2CoreUpdatePolicySettings>
  replace(
    expectedGeneration: number,
    settings: WritableHomeV2CoreUpdatePolicySettings,
  ): Promise<HomeV2CoreUpdatePolicySettings>
  trigger(): unknown
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function parseGet(value: unknown) {
  if (!exact(value, ['revision', 'schema']) ||
    value.schema !== 'home-v2-core-update-policy-get-request' || value.revision !== 1) {
    throw new Error('An exact Core update policy request is required.')
  }
}

function parseSet(value: unknown) {
  if (!exact(value, ['expectedGeneration', 'field', 'revision', 'schema', 'value']) ||
    value.schema !== 'home-v2-core-update-policy-set-request' || value.revision !== 1 ||
    !Number.isSafeInteger(value.expectedGeneration) || (value.expectedGeneration as number) < 0 ||
    (value.field !== 'coreUpdatePolicy' && value.field !== 'javaUpdatePolicy') ||
    (value.value !== 'off' && value.value !== 'notify' && value.value !== 'install')) {
    throw new Error('An exact Core update policy change is required.')
  }
  return {
    expectedGeneration: value.expectedGeneration as number,
    field: value.field as 'coreUpdatePolicy' | 'javaUpdatePolicy',
    value: value.value as HomeV2CoreUpdatePolicy,
  }
}

function response(
  settings: HomeV2CoreUpdatePolicySettings,
  activity: HomeV2CoreUpdateActivity,
): HomeV2CoreUpdatePolicyState {
  const currentActivity = !settings.storageIssue && activity.generation === settings.generation
    ? activity
    : idleHomeV2CoreUpdateActivity(settings.generation)
  return {
    activity: currentActivity,
    coreUpdatePolicy: settings.coreUpdatePolicy,
    generation: settings.generation,
    javaUpdatePolicy: settings.javaUpdatePolicy,
    revision: 1,
    schema: 'home-v2-core-update-policy',
    settingsIssue: settings.storageIssue ? 'settings-unavailable' : null,
  }
}

function publicStorageError(): Error {
  const error = new Error('Core update policy settings are unavailable.')
  Object.assign(error, { code: 'SETTINGS_UNAVAILABLE' })
  return error
}

function setResult(
  outcome: HomeV2CoreUpdatePolicySetResult['outcome'],
  state: HomeV2CoreUpdatePolicyState,
): HomeV2CoreUpdatePolicySetResult {
  return {
    outcome,
    revision: 1,
    schema: 'home-v2-core-update-policy-set-result',
    state,
  }
}

export function createHomeV2CoreUpdatePolicyService(dependencies: Dependencies) {
  return {
    async get(value: unknown) {
      parseGet(value)
      try {
        return response(await dependencies.read(), dependencies.getActivity())
      } catch {
        throw publicStorageError()
      }
    },
    async set(value: unknown) {
      const request = parseSet(value)
      homeV2CoreOperationCoordinator.revokeAutomaticWork()
      try {
        const current = await dependencies.read()
        const settings = await dependencies.replace(request.expectedGeneration, {
          coreUpdatePolicy: request.field === 'coreUpdatePolicy'
            ? request.value
            : current.coreUpdatePolicy,
          javaUpdatePolicy: request.field === 'javaUpdatePolicy'
            ? request.value
            : current.javaUpdatePolicy,
        })
        dependencies.trigger()
        return setResult('saved', response(settings, dependencies.getActivity()))
      } catch (error) {
        if ((error as { code?: unknown })?.code === 'SETTINGS_CHANGED') {
          try {
            return setResult(
              'conflict',
              response(await dependencies.read(), dependencies.getActivity()),
            )
          } catch {
            throw publicStorageError()
          }
        }
        throw publicStorageError()
      }
    },
  }
}

export function createAuthorizedHomeV2CoreUpdatePolicyHandlers(
  assertAuthorized: (event: IpcMainInvokeEvent) => void,
  service: ReturnType<typeof createHomeV2CoreUpdatePolicyService>,
) {
  return {
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
