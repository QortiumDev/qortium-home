/**
 * The renderer half of the Home-settings bridge: the thing that actually
 * composes a read and performs a write.
 *
 * Home 1.x answered GET_HOME_SETTINGS / UPDATE_HOME_SETTINGS in the renderer
 * because the renderer owns display settings, and Home 2 keeps that shape. On
 * desktop the main process asks this responder over an IPC round-trip; on
 * Android the renderer is the host and calls it directly. Both paths run this
 * exact code, so the two platforms cannot disagree about what a read reports or
 * what a write does.
 *
 * THE TWO-STORE SPLIT is the whole reason this module is not a one-liner. The
 * seven keys do not live together in Home 2:
 *
 *   - theme, accent, language, textSize, appZoom, ui  -> shell appearance state
 *     (src/v2/appearance.ts), written with the shell's own setters;
 *   - appNotifications                                -> the notification
 *     POLICY, written through the notification-policy client's generation
 *     compare-and-set.
 *
 * A write is therefore split by key. The app never touches the trusted policy
 * IPC: Home prompts, and Home's own renderer performs the write with the client
 * it already holds — the same indirection 1.x used, and the same one BOOKMARKS_*
 * uses via the collections client.
 */
import {
  clampHomeV2AppZoom,
  type HomeV2AppearanceSettings,
  type HomeV2ResolvedLanguage,
  type HomeV2ResolvedTheme,
} from '../v2/appearance'
import type { HomeV2NotificationPolicyState } from './notification-policy-client'
import {
  parseHomeV2HomeSettings,
  projectHomeV2HomeSettings,
  type HomeV2HomeSettings,
  type HomeV2HomeSettingsPatch,
} from '../../electron/home-v2-home-settings-contract'

/**
 * Every appearance key the bridge may write, and nothing else.
 *
 * Explicit rather than derived from the patch's own keys: `resolvedTheme` and
 * `resolvedLanguage` are appearance fields too, and they are Home's to compute,
 * never an app's to set.
 */
const APPEARANCE_KEYS = Object.freeze([
  'theme',
  'accent',
  'language',
  'textSize',
  'appZoom',
  'ui',
] as const)

export type HomeV2HomeSettingsAppearanceKey = (typeof APPEARANCE_KEYS)[number]

/**
 * HomeV2AppearanceSettings is fully readonly, so Partial<> of it cannot be
 * assembled field by field. This is the same shape with the modifier stripped —
 * used only to BUILD a patch, which is then handed to the shell's setter as an
 * ordinary Partial.
 */
type MutableAppearancePatch = {
  -readonly [Key in keyof HomeV2AppearanceSettings]?: HomeV2AppearanceSettings[Key]
}

export interface HomeV2HomeSettingsResponderDependencies {
  /** The shell's current appearance. Read fresh on every request. */
  readonly getAppearance: () => HomeV2AppearanceSettings
  /**
   * Applies an appearance patch through the shell's own setter. Includes the
   * resolved theme/language Home derived, never values an app supplied.
   */
  readonly applyAppearance: (
    patch: Partial<HomeV2AppearanceSettings>,
  ) => void | Promise<void>
  /** The last known notification policy, or null before the first read. */
  readonly getNotificationPolicy: () => HomeV2NotificationPolicyState | null
  /** Re-reads the policy from its store. Used to recover from a CAS conflict. */
  readonly refreshNotificationPolicy: () => Promise<HomeV2NotificationPolicyState>
  readonly setNotificationPolicy: (request: {
    readonly enabled: boolean
    readonly expectedGeneration: number
  }) => Promise<HomeV2NotificationPolicyState>
  readonly resolveSystemTheme: () => HomeV2ResolvedTheme
  readonly resolveSystemLanguage: () => HomeV2ResolvedLanguage
}

export interface HomeV2HomeSettingsResponder {
  read(): Promise<HomeV2HomeSettings>
  apply(patch: HomeV2HomeSettingsPatch): Promise<HomeV2HomeSettings>
}

function codedError(code: string, message: string) {
  return Object.assign(new Error(message), { code })
}

function isStale(error: unknown) {
  return !!error && typeof error === 'object' &&
    (error as { code?: unknown }).code === 'HOME_DATA_STALE'
}

/**
 * Composes the seven keys from the two stores.
 *
 * Deliberately built key by key from named fields rather than by spreading the
 * appearance object: appearance carries `resolvedTheme` and `resolvedLanguage`
 * as well, and a spread would leak them into a reply that is contractually
 * exactly seven keys. projectHomeV2HomeSettings then re-derives the projection
 * from the schema and validates it, so a future eighth appearance field cannot
 * reach an app even if this function were changed carelessly.
 */
function composeHomeSettings(
  appearance: HomeV2AppearanceSettings,
  policy: HomeV2NotificationPolicyState | null,
): HomeV2HomeSettings {
  return projectHomeV2HomeSettings(parseHomeV2HomeSettings({
    accent: appearance.accent,
    // A policy that is missing, corrupt or unreadable reports notifications as
    // OFF, matching failedClosedHomeV2NotificationPolicyState. That is the
    // truthful answer — in every one of those states no notification will be
    // shown — and it is the safe direction to be wrong in.
    appNotifications: policy?.status === 'available' ? policy.enabled : false,
    appZoom: clampHomeV2AppZoom(appearance.appZoom),
    language: appearance.language,
    textSize: appearance.textSize,
    theme: appearance.theme,
    ui: appearance.ui,
  }))
}

/**
 * Splits a validated patch into its appearance half and its notification half.
 * Exported for the tests that pin the split; the responder is the only caller.
 */
export function splitHomeV2HomeSettingsPatch(patch: HomeV2HomeSettingsPatch): {
  readonly appearance: MutableAppearancePatch
  readonly appNotifications: boolean | null
} {
  const appearance: MutableAppearancePatch = {}
  // Key by key rather than by spread. Every one of the six is type-compatible
  // with its appearance counterpart (the contract's accent union is a SUBSET of
  // Home 2's, which is the clay asymmetry seen from the write side), and naming
  // them keeps a future seventh contract key from silently becoming an
  // appearance write.
  if (Object.hasOwn(patch, 'theme')) appearance.theme = patch.theme
  if (Object.hasOwn(patch, 'accent')) appearance.accent = patch.accent
  if (Object.hasOwn(patch, 'language')) appearance.language = patch.language
  if (Object.hasOwn(patch, 'textSize')) appearance.textSize = patch.textSize
  if (Object.hasOwn(patch, 'appZoom')) appearance.appZoom = patch.appZoom
  if (Object.hasOwn(patch, 'ui')) appearance.ui = patch.ui
  return {
    appearance,
    appNotifications: Object.hasOwn(patch, 'appNotifications')
      ? patch.appNotifications === true
      : null,
  }
}

export function createHomeV2HomeSettingsResponder(
  dependencies: HomeV2HomeSettingsResponderDependencies,
): HomeV2HomeSettingsResponder {
  const readPolicy = async () => {
    const known = dependencies.getNotificationPolicy()
    if (known) return known
    return dependencies.refreshNotificationPolicy()
  }

  return {
    async read() {
      return composeHomeSettings(dependencies.getAppearance(), await readPolicy())
    },

    async apply(patch) {
      const split = splitHomeV2HomeSettingsPatch(patch)
      const current = dependencies.getAppearance()

      // The notification half goes FIRST, because it is the half that can fail.
      // Appearance writes cannot: they are local state with no compare-and-set.
      // Doing the fallible write first means a rejected patch leaves the user's
      // appearance untouched, instead of half-applying and then reporting an
      // error the app cannot act on.
      let policy = await readPolicy()
      if (split.appNotifications !== null) {
        policy = await writeNotificationPolicy(dependencies, split.appNotifications, policy)
      }

      const appearancePatch: MutableAppearancePatch = { ...split.appearance }
      // appZoom is already validated to an integer within 50-200 by the shared
      // contract; clamping here is defence in depth against a future caller
      // that skips the contract, and a no-op for anything that came through it.
      if (Object.hasOwn(appearancePatch, 'appZoom')) {
        appearancePatch.appZoom = clampHomeV2AppZoom(appearancePatch.appZoom)
      }
      // Home derives the resolved values. An app names a PREFERENCE ('system',
      // 'dark', 'fr'); what that preference resolves to on this device is never
      // the app's to state.
      if (typeof appearancePatch.theme === 'string') {
        appearancePatch.resolvedTheme = appearancePatch.theme === 'system'
          ? dependencies.resolveSystemTheme()
          : appearancePatch.theme
      }
      if (typeof appearancePatch.language === 'string') {
        appearancePatch.resolvedLanguage = appearancePatch.language === 'system'
          ? dependencies.resolveSystemLanguage()
          : appearancePatch.language
      }
      if (Object.keys(appearancePatch).length > 0) {
        await dependencies.applyAppearance(appearancePatch)
      }

      // Composed from the patch applied onto the appearance read at the top of
      // this call, NOT from a fresh getAppearance(). The shell's setter is a
      // React state update, so an immediate re-read would still report the old
      // value and the app would be told its approved write had not happened.
      return composeHomeSettings({ ...current, ...appearancePatch }, policy)
    },
  }
}

/**
 * Writes the notification half, recovering once from a compare-and-set
 * conflict.
 *
 * The policy client rejects with code HOME_DATA_STALE when the generation it
 * was handed is no longer current — the user toggled notifications in Settings
 * between this request being approved and it being applied. That is a race, not
 * a refusal, so the conflict is resolved by re-reading and retrying against the
 * generation that is now current. A SECOND conflict is surfaced: two losses in
 * a row means something else is writing continuously, and silently looping
 * would let an app's write win a fight against the user's own hand.
 */
async function writeNotificationPolicy(
  dependencies: HomeV2HomeSettingsResponderDependencies,
  enabled: boolean,
  known: HomeV2NotificationPolicyState,
): Promise<HomeV2NotificationPolicyState> {
  const requireAvailable = (state: HomeV2NotificationPolicyState) => {
    if (state.status !== 'available' || state.generation === null) {
      throw codedError(
        state.status === 'corrupt'
          ? 'HOME_NOTIFICATION_POLICY_CORRUPT'
          : 'HOME_NOTIFICATION_POLICY_UNAVAILABLE',
        'Notification settings are unavailable.',
      )
    }
    return state.generation
  }

  try {
    return await dependencies.setNotificationPolicy({
      enabled,
      expectedGeneration: requireAvailable(known),
    })
  } catch (error) {
    if (!isStale(error)) throw error
    const refreshed = await dependencies.refreshNotificationPolicy()
    return dependencies.setNotificationPolicy({
      enabled,
      expectedGeneration: requireAvailable(refreshed),
    })
  }
}
