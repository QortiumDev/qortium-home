/**
 * The app-facing Home-settings contract shared by Home 2's desktop and Android
 * bridges, and by the shell renderer that actually answers a request.
 *
 * Home 1.x exposed three actions — GET_HOME_SETTINGS_METADATA, GET_HOME_SETTINGS
 * and UPDATE_HOME_SETTINGS — over a deliberately narrow seven-key display
 * surface (electron/home-settings-bridge.ts + electron/qdn.ts). Home 2 never
 * carried them over. This module restores the same three, with the same
 * seven-key contract, on both Home 2 hosts.
 *
 * ARCHITECTURE (deliberate, and the reason this module exists at all).
 *
 * Home 1.x resolved these IN THE RENDERER, via a host round-trip
 * (requestHomeSettingsFromHostWindow, qdn.ts:904-940), because the renderer —
 * not the main process — owns display settings. Home 2 keeps that shape: the
 * desktop main process does NOT read or write these settings, it asks the shell
 * window for them over `home-v2-app:home-settings-request` and the shell
 * composes the answer. On Android the shell renderer IS the host, so the
 * composition is direct and no IPC is involved.
 *
 * That indirection is the load-bearing posture point. The seven keys live in
 * TWO different stores in Home 2:
 *
 *   - six appearance keys (theme, accent, language, textSize, appZoom, ui) are
 *     shell state, owned by src/v2/appearance.ts and the shell's snapshot;
 *   - appNotifications is the notification POLICY, owned by the trusted
 *     notification-policy IPC with its own generation compare-and-set.
 *
 * The app never touches the trusted policy IPC. Home prompts the user, and
 * Home's own renderer performs the write through the policy client it already
 * holds. Exactly the same indirection as 1.x, and as BOOKMARKS_* via the
 * collections client. An app supplies a validated patch and nothing else.
 *
 * This module owns request parsing, the seven-key projection, the metadata
 * table, the round-trip envelope codec and the approval-detail rows. It owns no
 * storage and imports no Electron, Node or DOM API, so both hosts and both ends
 * of the round-trip validate against exactly the same rules.
 *
 * Pattern-matched on home-v2-qdn-settings-contract.ts (exact()-style key
 * checking) and home-v2-notification-manager-contract.ts (one validator, two
 * hosts).
 */
import {
  HOME_SETTINGS_SCHEMA,
  getHomeSettingsApprovalDetails,
  getHomeSettingsMetadata,
  getWritableHomeSettings,
  validateHomeSettingsPatch,
  type HomeSettingKey,
  type HomeSettings,
} from './home-settings-bridge.js'

/**
 * The complete app-facing surface. Exactly the 1.x three and nothing more.
 *
 * Home 2 does NOT add a node-settings, wallet, bookmark, start-page or
 * update-policy sibling here. The whole value of this bridge is that it is
 * small enough to reason about: seven display keys, one of which is a boolean
 * notification toggle.
 */
export const HOME_V2_HOME_SETTINGS_ACTIONS = Object.freeze([
  'GET_HOME_SETTINGS_METADATA',
  'GET_HOME_SETTINGS',
  'UPDATE_HOME_SETTINGS',
] as const)

export type HomeV2HomeSettingsAction =
  (typeof HOME_V2_HOME_SETTINGS_ACTIONS)[number]

/**
 * The two that never prompt. 1.x answered both without approval and Home 2
 * keeps that: they disclose the user's own theme, accent, language, text size,
 * zoom, interface style and a notifications-on boolean — the same display
 * subset Home already hands every app as render-URL query parameters
 * (`theme`, `lang`, `textSize`, `accent`, `uiStyle`) before the app's first
 * line of script runs. Prompting for data the app is already given for free
 * would train users to click through prompts that protect nothing.
 */
export const HOME_V2_HOME_SETTINGS_UNPROMPTED_ACTIONS = Object.freeze([
  'GET_HOME_SETTINGS_METADATA',
  'GET_HOME_SETTINGS',
] as const)

/**
 * The one that always prompts, and always single-request.
 *
 * Never 'session', never 'always'. A durable grant to rewrite the user's theme,
 * language and notification toggle is a grant whose effects the user would see
 * without being able to attribute them to any app — and unlike bookmarks or
 * notification rules, there is no settings surface that lists "apps that may
 * change my appearance". One approval, one patch.
 */
export const HOME_V2_HOME_SETTINGS_PROMPTED_ACTION = 'UPDATE_HOME_SETTINGS' as const

export function isHomeV2HomeSettingsAction(
  value: unknown,
): value is HomeV2HomeSettingsAction {
  return typeof value === 'string' &&
    (HOME_V2_HOME_SETTINGS_ACTIONS as readonly string[]).includes(value)
}

export function isHomeV2HomeSettingsUnpromptedAction(value: unknown): boolean {
  return typeof value === 'string' &&
    (HOME_V2_HOME_SETTINGS_UNPROMPTED_ACTIONS as readonly string[]).includes(value)
}

/**
 * The one accent Home 2 has that 1.x's HOME_SETTINGS_SCHEMA does not list.
 *
 * `clay` is Home 2's DEFAULT accent (defaultHomeV2Appearance in
 * src/v2/appearance.ts), so on a fresh Home 2 profile GET_HOME_SETTINGS would
 * otherwise fail validation against its own live value — the read would be
 * broken for the majority of users. It is therefore accepted on the READ side
 * and advertised in the metadata.
 *
 * It stays OUT of the write set on purpose. UPDATE_HOME_SETTINGS is a
 * 1.x-compatible surface: an app written against Home 1.x's documented accent
 * list must behave identically on Home 2, and an app that learns a tenth accent
 * exists should not be the thing that moves a user onto it. Discovering a value
 * and being able to set it are separate questions, and this is the one place
 * where Home 2's answer to them differs.
 *
 * The asymmetry is documented in docs/HOME_SETTINGS_BRIDGE.md.
 */
export const HOME_V2_READ_ONLY_ACCENTS = Object.freeze(['clay'] as const)

export type HomeV2ReadOnlyAccent = (typeof HOME_V2_READ_ONLY_ACCENTS)[number]

/** The seven keys as Home 2 may REPORT them: 1.x's shape, widened at accent. */
export type HomeV2HomeSettings = Omit<HomeSettings, 'accent'> & {
  readonly accent: HomeSettings['accent'] | HomeV2ReadOnlyAccent
}

/** The seven keys, in schema order. The projection and nothing else. */
export const HOME_V2_HOME_SETTINGS_KEYS = Object.freeze(
  HOME_SETTINGS_SCHEMA.map(({ key }) => key),
) as readonly HomeSettingKey[]

export type HomeV2HomeSettingsMetadata = readonly {
  readonly key: HomeSettingKey
  readonly type: 'boolean' | 'number' | 'string'
  /** Every value GET_HOME_SETTINGS may return for this key. */
  readonly allowedValues?: readonly string[]
  /** The subset UPDATE_HOME_SETTINGS accepts. Differs from allowedValues only at accent. */
  readonly writableValues?: readonly string[]
  readonly min?: number
  readonly max?: number
  readonly default: string | number | boolean
}[]

/**
 * The metadata table, with the clay asymmetry made explicit rather than left
 * for an app to discover by having a write rejected.
 *
 * `allowedValues` is the value space a READ may return; `writableValues` is
 * what a WRITE accepts. They are emitted for every enumerated key, equal for
 * six of the seven, so an app has one uniform rule — write only what is in
 * `writableValues` — instead of a special case it has to know about.
 */
export function getHomeV2HomeSettingsMetadata(): HomeV2HomeSettingsMetadata {
  return getHomeSettingsMetadata().map((entry) => {
    if (!entry.allowedValues) return { ...entry }
    const writableValues = Object.freeze([...entry.allowedValues])
    const allowedValues = entry.key === 'accent'
      ? Object.freeze([...HOME_V2_READ_ONLY_ACCENTS, ...entry.allowedValues])
      : writableValues
    return { ...entry, allowedValues, writableValues }
  })
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

/**
 * Validates a complete seven-key settings object, tolerating a read-only
 * accent. This is the shape the shell renderer answers a read with and the
 * shape the main process hands back to the app: exactly seven keys, no more.
 *
 * Exact-key, not superset-tolerant. A renderer that grew an eighth field —
 * a node URL, an account id, an API key — would fail here rather than have it
 * forwarded to an app, which is the entire point of validating a reply the
 * main process did not itself construct.
 */
export function parseHomeV2HomeSettings(value: unknown): HomeV2HomeSettings {
  if (!exact(value, HOME_V2_HOME_SETTINGS_KEYS)) {
    throw new Error('Home settings must be exactly the seven writable keys.')
  }
  const accent: unknown = value.accent
  const readOnlyAccent = typeof accent === 'string' &&
    (HOME_V2_READ_ONLY_ACCENTS as readonly string[]).includes(accent)
  // Re-use the 1.x validator for everything except a read-only accent, which
  // it does not know about. Substituting a known-good accent keeps every other
  // key under exactly the same rules the 1.x bridge enforced.
  const forValidation = readOnlyAccent ? { ...value, accent: 'green' } : value
  const validated = validateHomeSettingsPatch(forValidation)
  for (const key of HOME_V2_HOME_SETTINGS_KEYS) {
    if (!Object.hasOwn(validated, key)) {
      throw new Error(`Home settings response is missing ${key}.`)
    }
  }
  return Object.freeze({
    ...(validated as HomeSettings),
    accent: (readOnlyAccent ? accent : validated.accent) as HomeV2HomeSettings['accent'],
  })
}

/**
 * Projects a settings object down to the seven keys.
 *
 * Uses getWritableHomeSettings so the projection can never drift from the
 * schema. The reason it exists is a security one: a read must return the seven
 * display keys and NOTHING else — never a node URL, never account data, never
 * an API key — and the only way to guarantee that is to build the reply from
 * the schema rather than from whatever the caller happened to hand over.
 */
export function projectHomeV2HomeSettings(
  settings: HomeV2HomeSettings,
): HomeV2HomeSettings {
  const projected = getWritableHomeSettings(settings as unknown as HomeSettings)
  return parseHomeV2HomeSettings(projected)
}

/**
 * A validated patch: one or more of the seven keys, every value legal.
 *
 * Delegates to the 1.x validator verbatim, which means unknown keys are
 * REFUSED (not ignored), an empty patch is refused, appZoom must be an integer
 * within 50-200, and `clay` is refused for accent because 1.x's schema does not
 * list it. That last one is the write half of the clay asymmetry and is load
 * bearing — do not "fix" it by widening HOME_SETTINGS_SCHEMA.
 *
 * appZoom is REJECTED when out of range rather than clamped. Clamping would
 * make the approval prompt show a proposed value the app never asked for, which
 * is worse than a clear error; the renderer still clamps on apply as
 * defence-in-depth, where it is a no-op for anything that passed here.
 */
export type HomeV2HomeSettingsPatch = Partial<HomeSettings>

export function parseHomeV2HomeSettingsPatch(value: unknown): HomeV2HomeSettingsPatch {
  return validateHomeSettingsPatch(value)
}

export type HomeV2HomeSettingsRequest =
  | { readonly action: 'GET_HOME_SETTINGS_METADATA'; readonly kind: 'metadata' }
  | { readonly action: 'GET_HOME_SETTINGS'; readonly kind: 'read' }
  | {
      readonly action: 'UPDATE_HOME_SETTINGS'
      readonly kind: 'update'
      readonly patch: HomeV2HomeSettingsPatch
    }

/**
 * Parses one app request.
 *
 * The patch is read from `patch`, then `settings`, then the request body
 * itself — the 1.x acceptance order (qdn.ts:955-957), kept so an app written
 * against Home 1.x calls Home 2 unchanged.
 *
 * Parsing happens BEFORE the permission prompt at both call sites, so a
 * malformed request cannot be used to raise a prompt the user would otherwise
 * never see, and a validation failure is not distinguishable from a denial by
 * whether a prompt appeared.
 */
export function parseHomeV2HomeSettingsRequest(
  action: HomeV2HomeSettingsAction,
  value: unknown,
): HomeV2HomeSettingsRequest {
  switch (action) {
    case 'GET_HOME_SETTINGS_METADATA':
      return { action, kind: 'metadata' }
    case 'GET_HOME_SETTINGS':
      return { action, kind: 'read' }
    case 'UPDATE_HOME_SETTINGS': {
      const request = isRecord(value) ? value : {}
      const explicit = request.patch ?? request.settings
      let body: unknown = explicit
      if (body === undefined || body === null) {
        // The bare-body form. `action` is stripped because the bridge hands the
        // whole app request through and 1.x's validator refuses unknown keys —
        // without this, `{ action, theme }` would be rejected for containing
        // `action`, which 1.x accepted.
        const rest: Record<string, unknown> = {}
        for (const [key, entry] of Object.entries(request)) {
          if (key !== 'action') rest[key] = entry
        }
        body = rest
      }
      return { action, kind: 'update', patch: parseHomeV2HomeSettingsPatch(body) }
    }
    default:
      // Unreachable for a caller that honoured the parameter type, and a
      // deliberate fail-closed backstop for one that did not.
      throw new Error('Home settings action is not supported.')
  }
}

/**
 * Per-key current-vs-proposed rows for the approval prompt, ported from 1.x
 * (getHomeSettingsApprovalDetails, home-settings-bridge.ts:139-147).
 *
 * The user sees what each named setting is now and what it would become. A
 * prompt that said only "this app wants to change your settings" would be a
 * prompt no one could answer correctly.
 */
export function getHomeV2HomeSettingsApprovalDetails(
  current: HomeV2HomeSettings,
  patch: HomeV2HomeSettingsPatch,
): readonly { readonly label: string; readonly value: string }[] {
  return Object.freeze(
    getHomeSettingsApprovalDetails(current as unknown as HomeSettings, patch)
      .map((detail) => Object.freeze({ ...detail })),
  )
}

// ---------------------------------------------------------------------------
// The desktop round-trip envelope.
//
// Main process -> shell window: "read your settings" / "apply this patch".
// Shell window -> main process: the resulting seven keys, or an error.
//
// Both ends validate with the functions below, so neither side has to trust
// the other's shape. Android never uses these: there the renderer is the host.
// ---------------------------------------------------------------------------

export const HOME_V2_HOME_SETTINGS_REQUEST_SCHEMA =
  'home-v2-home-settings-request' as const

export type HomeV2HomeSettingsRoundTripRequest = {
  readonly id: string
  readonly operation: 'apply' | 'read'
  readonly patch: HomeV2HomeSettingsPatch | null
  readonly revision: 1
  readonly schema: typeof HOME_V2_HOME_SETTINGS_REQUEST_SCHEMA
}

export function encodeHomeV2HomeSettingsRoundTripRequest(input: {
  readonly id: string
  readonly operation: 'apply' | 'read'
  readonly patch?: HomeV2HomeSettingsPatch | null
}): HomeV2HomeSettingsRoundTripRequest {
  if (typeof input.id !== 'string' || !input.id) {
    throw new Error('A Home settings round-trip request needs an id.')
  }
  if (input.operation !== 'apply' && input.operation !== 'read') {
    throw new Error('A Home settings round-trip request needs a known operation.')
  }
  // An apply with no patch, or a read carrying one, is a caller bug that would
  // otherwise reach the shell as a no-op or an unrequested write.
  if (input.operation === 'apply' && !input.patch) {
    throw new Error('A Home settings apply needs a patch.')
  }
  if (input.operation === 'read' && input.patch) {
    throw new Error('A Home settings read must not carry a patch.')
  }
  return Object.freeze({
    id: input.id,
    operation: input.operation,
    patch: input.patch ? Object.freeze(parseHomeV2HomeSettingsPatch(input.patch)) : null,
    revision: 1 as const,
    schema: HOME_V2_HOME_SETTINGS_REQUEST_SCHEMA,
  })
}

/**
 * The shell renderer's view of what main asked for. Exact-key: the shell
 * refuses to act on an envelope it does not fully recognise rather than
 * executing the subset it does.
 */
export function parseHomeV2HomeSettingsRoundTripRequest(
  value: unknown,
): HomeV2HomeSettingsRoundTripRequest {
  if (
    !exact(value, ['id', 'operation', 'patch', 'revision', 'schema']) ||
    value.revision !== 1 ||
    value.schema !== HOME_V2_HOME_SETTINGS_REQUEST_SCHEMA ||
    typeof value.id !== 'string' ||
    !value.id ||
    (value.operation !== 'apply' && value.operation !== 'read')
  ) {
    throw new Error('An exact Home 2 Home settings request is required.')
  }
  const id = value.id as string
  const operation = value.operation as 'apply' | 'read'
  if (operation === 'read') {
    if (value.patch !== null) {
      throw new Error('A Home settings read must not carry a patch.')
    }
    return Object.freeze({
      id,
      operation: 'read' as const,
      patch: null,
      revision: 1 as const,
      schema: HOME_V2_HOME_SETTINGS_REQUEST_SCHEMA,
    })
  }
  return Object.freeze({
    id,
    operation: 'apply' as const,
    // Re-validated in the renderer even though main validated it: the shell is
    // the thing that actually writes, so it does not delegate its own gate.
    patch: Object.freeze(parseHomeV2HomeSettingsPatch(value.patch)),
    revision: 1 as const,
    schema: HOME_V2_HOME_SETTINGS_REQUEST_SCHEMA,
  })
}

export type HomeV2HomeSettingsRoundTripResponse = {
  readonly requestId: string
  readonly settings: HomeV2HomeSettings
}

/**
 * The main process's view of what the shell replied. Returns the seven keys or
 * throws; a coded error travels as its own envelope field and is handled by
 * the caller, not here.
 */
export function parseHomeV2HomeSettingsRoundTripResponse(
  value: unknown,
): HomeV2HomeSettingsRoundTripResponse {
  if (!isRecord(value) || typeof value.requestId !== 'string' || !value.requestId) {
    throw new Error('A Home settings round-trip response needs a requestId.')
  }
  return Object.freeze({
    requestId: value.requestId as string,
    settings: parseHomeV2HomeSettings(value.settings),
  })
}
