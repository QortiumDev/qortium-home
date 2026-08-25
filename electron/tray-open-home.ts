// What the tray's "Open Qortium Home" should actually do.
//
// The old handler raised an existing window and stopped there, so when a Home
// window was already open and focused — the common case — the menu item did
// nothing at all despite being labelled "Open". Raising and opening are two
// different intents, and which one the user meant is decided entirely by the
// state of the windows already on screen.
//
// Deliberately free of Electron types: it takes a plain snapshot of each
// candidate window, so the rules can be tested without a display.

export type TrayOpenHomePlacement = 'primary' | 'secondary';

export interface TrayHomeWindowSnapshot {
  readonly id: number;
  readonly isFocused: boolean;
  readonly isMinimized: boolean;
  readonly isVisible: boolean;
}

export type TrayOpenHomePlan =
  /** Bring an existing window to the front. */
  | { readonly kind: 'raise'; readonly windowId: number }
  /**
   * Open another window. `placement` is 'secondary' whenever Home windows
   * already exist, so the new one is offset instead of stacking exactly on the
   * primary's remembered geometry (and so it cannot save over it).
   */
  | { readonly kind: 'open-new'; readonly placement: TrayOpenHomePlacement };

/**
 * Chooses between raising an existing Home window and opening a new one.
 *
 * `mostRecentId` is the most recently focused candidate, or null when none has
 * ever been focused — creation order is arbitrary once more than one window is
 * open, so falling back to first-found is a last resort rather than the rule.
 */
export function planTrayOpenHome(
  windows: readonly TrayHomeWindowSnapshot[],
  mostRecentId: number | null,
): TrayOpenHomePlan {
  const target =
    windows.find((window) => window.id === mostRecentId) ?? windows[0];

  // Nothing to raise: this is the state the tray exists for, where Home is
  // running with only widgets on screen.
  if (!target) return { kind: 'open-new', placement: 'primary' };

  // Already in front and taking input, so "Open" can only sensibly mean another
  // window. Anything else — minimized, hidden, or merely behind something —
  // is answered by bringing this one forward.
  if (target.isVisible && target.isFocused && !target.isMinimized) {
    return { kind: 'open-new', placement: 'secondary' };
  }

  return { kind: 'raise', windowId: target.id };
}
