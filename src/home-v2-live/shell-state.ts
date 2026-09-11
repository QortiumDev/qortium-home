import {
  migrateLegacyAppearance,
  type HomeV2AppearanceSettings,
  type HomeV2ResolvedLanguage,
  type HomeV2ResolvedTheme,
} from '../v2/appearance'
import {
  createProductState,
  restoreProductState,
  type ProductState,
  type RestoreProductStateOptions,
} from '../v2/product-model'
import {
  DEFAULT_NEW_TAB_PREFERENCE,
  parseNewTabPreference,
  type NewTabPreference,
} from '../v2/new-tab-preference'
import {
  DEFAULT_STARTUP_PREFERENCE,
  parseHomeV2StartupPreference,
  type HomeV2StartupPreference,
} from '../v2/startup-preference'
import {
  parseHomeV2SettingsSection,
  type HomeV2SettingsSectionId,
} from '../v2/shell/SettingsPage'
import {
  createHomeV2OnboardingState,
  parseHomeV2OnboardingState,
  type HomeV2OnboardingState,
} from './onboarding-state'

export type HomeV2DashboardSection = 'account' | 'pinnedApps'
export type HomeV2DashboardCollapsed = Readonly<Record<HomeV2DashboardSection, boolean>>

export const HOME_V2_DASHBOARD_SECTIONS: readonly HomeV2DashboardSection[] = ['account', 'pinnedApps']

export function createHomeV2DashboardCollapsed(): HomeV2DashboardCollapsed {
  return Object.freeze({ account: false, pinnedApps: false })
}

// Absent before the setting existed, and unknown sections are ignored:
// everything stays expanded, which is what the dashboard showed.
export function parseHomeV2DashboardCollapsed(value: unknown): HomeV2DashboardCollapsed {
  const record = isRecord(value) ? value : {}
  return Object.freeze({
    account: record.account === true,
    pinnedApps: record.pinnedApps === true,
  })
}

export interface HomeV2ShellState {
  readonly version: 4
  readonly appearance: HomeV2AppearanceSettings
  readonly newTabPreference: NewTabPreference
  readonly startupPreference: HomeV2StartupPreference
  readonly settingsSection: HomeV2SettingsSectionId
  /** Which dashboard sections are folded to their header line. */
  readonly dashboardCollapsed: HomeV2DashboardCollapsed
  readonly onboarding: HomeV2OnboardingState
  readonly selectedAccountId: string | null
  readonly selectedAddressId: string | null
  readonly product: ProductState
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function createHomeV2ShellState(
  systemTheme: HomeV2ResolvedTheme,
  systemLanguage: HomeV2ResolvedLanguage,
): HomeV2ShellState {
  return Object.freeze({
    version: 4 as const,
    appearance: Object.freeze(
      migrateLegacyAppearance(null, systemTheme, systemLanguage),
    ),
    newTabPreference: DEFAULT_NEW_TAB_PREFERENCE,
    startupPreference: DEFAULT_STARTUP_PREFERENCE,
    settingsSection: 'general',
    dashboardCollapsed: createHomeV2DashboardCollapsed(),
    onboarding: createHomeV2OnboardingState(),
    selectedAccountId: null,
    selectedAddressId: null,
    product: createProductState(),
  })
}

export function parseHomeV2ShellState(
  value: unknown,
  systemTheme: HomeV2ResolvedTheme,
  systemLanguage: HomeV2ResolvedLanguage,
  // Which node the caller is currently admin-trusted on, so a persisted publish
  // preview can be restored against THAT node instead of being kept on a
  // loopback shape check. Omitted (the shell's own default before the trust
  // resolver has answered) drops every stored preview.
  options: RestoreProductStateOptions = {},
): HomeV2ShellState {
  const fallback = createHomeV2ShellState(systemTheme, systemLanguage)
  if (
    !isRecord(value) ||
    (value.version !== 1 &&
      value.version !== 2 &&
      value.version !== 3 &&
      value.version !== 4)
  ) return fallback
  const legacySelection =
    typeof value.selectedAccountId === 'string' &&
    value.selectedAccountId.trim() &&
    value.selectedAccountId.length <= 240
      ? value.selectedAccountId.trim()
      : null
  const selectedAddressId =
    (value.version === 2 || value.version === 3 || value.version === 4) &&
    typeof value.selectedAddressId === 'string' &&
    value.selectedAddressId.trim() &&
    value.selectedAddressId.length <= 240
      ? value.selectedAddressId.trim()
      : legacySelection
  const selectedAccountId =
    value.version === 2 || value.version === 3 || value.version === 4
      ? legacySelection
      : legacySelection?.split(':').slice(0, 2).join(':') ?? null
  return Object.freeze({
    version: 4 as const,
    appearance: Object.freeze(
      migrateLegacyAppearance(
        isRecord(value.appearance) ? value.appearance : null,
        systemTheme,
        systemLanguage,
      ),
    ),
    newTabPreference: parseNewTabPreference(value.newTabPreference),
    // Absent before version 4, and the fallback is 'restore' -- exactly what
    // Home did before the setting existed, so an upgrade changes nothing until
    // the user chooses otherwise.
    startupPreference: parseHomeV2StartupPreference(value.startupPreference),
    settingsSection: parseHomeV2SettingsSection(value.settingsSection),
    dashboardCollapsed: parseHomeV2DashboardCollapsed(value.dashboardCollapsed),
    onboarding:
      value.version === 3 || value.version === 4
        ? parseHomeV2OnboardingState(value.onboarding) ??
          createHomeV2OnboardingState()
        : createHomeV2OnboardingState('skipped', 'finish'),
    selectedAccountId,
    selectedAddressId,
    product: restoreProductState(value.product, options),
  })
}

export function serializeHomeV2ShellState(state: HomeV2ShellState) {
  return {
    version: 4 as const,
    appearance: {
      accent: state.appearance.accent,
      appZoom: state.appearance.appZoom,
      language: state.appearance.language,
      textSize: state.appearance.textSize,
      theme: state.appearance.theme,
      ui: state.appearance.ui,
    },
    newTabPreference: state.newTabPreference,
    startupPreference: state.startupPreference,
    settingsSection: state.settingsSection,
    dashboardCollapsed: { ...state.dashboardCollapsed },
    onboarding: state.onboarding,
    selectedAccountId: state.selectedAccountId,
    selectedAddressId: state.selectedAddressId,
    product: {
      activeTabId: state.product.activeTabId,
      entries: state.product.entries,
    },
  }
}
