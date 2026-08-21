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
} from '../v2/product-model'
import {
  DEFAULT_NEW_TAB_PREFERENCE,
  parseNewTabPreference,
  type NewTabPreference,
} from '../v2/new-tab-preference'

export interface HomeV2ShellState {
  readonly version: 2
  readonly appearance: HomeV2AppearanceSettings
  readonly newTabPreference: NewTabPreference
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
    version: 2 as const,
    appearance: Object.freeze(
      migrateLegacyAppearance(null, systemTheme, systemLanguage),
    ),
    newTabPreference: DEFAULT_NEW_TAB_PREFERENCE,
    selectedAccountId: null,
    selectedAddressId: null,
    product: createProductState(),
  })
}

export function parseHomeV2ShellState(
  value: unknown,
  systemTheme: HomeV2ResolvedTheme,
  systemLanguage: HomeV2ResolvedLanguage,
): HomeV2ShellState {
  const fallback = createHomeV2ShellState(systemTheme, systemLanguage)
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2)) return fallback
  const legacySelection =
    typeof value.selectedAccountId === 'string' &&
    value.selectedAccountId.trim() &&
    value.selectedAccountId.length <= 240
      ? value.selectedAccountId.trim()
      : null
  const selectedAddressId =
    value.version === 2 &&
    typeof value.selectedAddressId === 'string' &&
    value.selectedAddressId.trim() &&
    value.selectedAddressId.length <= 240
      ? value.selectedAddressId.trim()
      : legacySelection
  const selectedAccountId =
    value.version === 2
      ? legacySelection
      : legacySelection?.split(':').slice(0, 2).join(':') ?? null
  return Object.freeze({
    version: 2 as const,
    appearance: Object.freeze(
      migrateLegacyAppearance(
        isRecord(value.appearance) ? value.appearance : null,
        systemTheme,
        systemLanguage,
      ),
    ),
    newTabPreference: parseNewTabPreference(value.newTabPreference),
    selectedAccountId,
    selectedAddressId,
    product: restoreProductState(value.product),
  })
}

export function serializeHomeV2ShellState(state: HomeV2ShellState) {
  return {
    version: 2 as const,
    appearance: {
      accent: state.appearance.accent,
      appZoom: state.appearance.appZoom,
      language: state.appearance.language,
      textSize: state.appearance.textSize,
      theme: state.appearance.theme,
    },
    newTabPreference: state.newTabPreference,
    selectedAccountId: state.selectedAccountId,
    selectedAddressId: state.selectedAddressId,
    product: {
      activeTabId: state.product.activeTabId,
      destination: state.product.destination,
      tabs: state.product.tabs,
    },
  }
}
