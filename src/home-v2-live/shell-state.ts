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

export interface HomeV2ShellState {
  readonly version: 1
  readonly appearance: HomeV2AppearanceSettings
  readonly selectedAccountId: string | null
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
    version: 1 as const,
    appearance: Object.freeze(
      migrateLegacyAppearance(null, systemTheme, systemLanguage),
    ),
    selectedAccountId: null,
    product: createProductState(),
  })
}

export function parseHomeV2ShellState(
  value: unknown,
  systemTheme: HomeV2ResolvedTheme,
  systemLanguage: HomeV2ResolvedLanguage,
): HomeV2ShellState {
  const fallback = createHomeV2ShellState(systemTheme, systemLanguage)
  if (!isRecord(value) || value.version !== 1) return fallback
  const selectedAccountId =
    typeof value.selectedAccountId === 'string' &&
    value.selectedAccountId.trim() &&
    value.selectedAccountId.length <= 240
      ? value.selectedAccountId.trim()
      : null
  return Object.freeze({
    version: 1 as const,
    appearance: Object.freeze(
      migrateLegacyAppearance(
        isRecord(value.appearance) ? value.appearance : null,
        systemTheme,
        systemLanguage,
      ),
    ),
    selectedAccountId,
    product: restoreProductState(value.product),
  })
}

export function serializeHomeV2ShellState(state: HomeV2ShellState) {
  return {
    version: 1 as const,
    appearance: {
      accent: state.appearance.accent,
      appZoom: state.appearance.appZoom,
      language: state.appearance.language,
      textSize: state.appearance.textSize,
      theme: state.appearance.theme,
    },
    selectedAccountId: state.selectedAccountId,
    product: {
      activeTabId: state.product.activeTabId,
      destination: state.product.destination,
      tabs: state.product.tabs,
    },
  }
}
