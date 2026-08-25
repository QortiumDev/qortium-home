import type { HomeV2CoreMaintenance } from './core-maintenance-controller'
import type { HomeV2QortalMaintenance } from './qortal-maintenance-controller'
import type { HomeV2TransportMaintenance } from './transport-maintenance-controller'

/**
 * The three maintenance controllers as one bundle, so the app can instantiate
 * each of them exactly once and hand the whole controller — not just the
 * trimmed `HomeV2CoreManagement` slice a dashboard tile needs — to the Settings
 * and Welcome panels.
 *
 * The panels need more than the tile slice: the Qortal adoption flow and the
 * automatic-update-policy selects exist only there. Each entry stays optional
 * because `HomeV2Prototype` is renderable from a fixture with no bridge at all,
 * and every panel already renders nothing when its domain is unavailable.
 */
export interface HomeV2MaintenanceControllers {
  readonly core?: HomeV2CoreMaintenance
  readonly qortal?: HomeV2QortalMaintenance
  readonly transport?: HomeV2TransportMaintenance
}
