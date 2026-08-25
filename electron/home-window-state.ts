// Window geometry, stored per window role.
//
// Home keeps one geometry file. While it held a single flat record, every
// window wrote to it, so resizing and closing a second window redefined the
// size the main window opened at next launch. `getInitialWindowState` already
// distinguished primary from secondary when READING; only the write side was
// missing the distinction.
//
// The parsing and merging live here, free of Electron, so the rules can be
// tested directly. File IO and display lookups stay in main.ts.

export type WindowStateRole = 'primary' | 'secondary';

export type WindowStateBounds = {
  height: number;
  isMaximized: boolean;
  width: number;
  x?: number;
  y?: number;
};

export type WindowStatesRecord = {
  primary?: WindowStateBounds;
  secondary?: WindowStateBounds;
};

export type WindowStateLimits = {
  defaultHeight: number;
  defaultWidth: number;
  minHeight: number;
  minWidth: number;
};

type Rect = { height: number; width: number; x: number; y: number };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeWindowState(
  value: unknown,
  limits: WindowStateLimits,
  isVisible: (bounds: Rect) => boolean,
): WindowStateBounds | undefined {
  if (!isRecord(value)) return undefined;

  const width = isFiniteNumber(value.width)
    ? Math.max(Math.round(value.width), limits.minWidth)
    : limits.defaultWidth;
  const height = isFiniteNumber(value.height)
    ? Math.max(Math.round(value.height), limits.minHeight)
    : limits.defaultHeight;
  const state: WindowStateBounds = {
    height,
    isMaximized: value.isMaximized === true,
    width,
  };

  // A position is only restored when it still lands on a display that exists,
  // so unplugging a monitor cannot strand a window off-screen.
  if (isFiniteNumber(value.x) && isFiniteNumber(value.y)) {
    const candidate = { height, width, x: Math.round(value.x), y: Math.round(value.y) };
    if (isVisible(candidate)) {
      state.x = candidate.x;
      state.y = candidate.y;
    }
  }

  return state;
}

/**
 * Reads the stored record, accepting the flat single-window shape written by
 * earlier versions as the primary window's geometry — an existing profile must
 * keep the size the user set, not be reset by the upgrade.
 */
export function parseWindowStates(
  value: unknown,
  limits: WindowStateLimits,
  isVisible: (bounds: Rect) => boolean,
): WindowStatesRecord {
  if (!isRecord(value)) return {};

  const hasRoles = isRecord(value.primary) || isRecord(value.secondary);
  if (!hasRoles) {
    const legacy = sanitizeWindowState(value, limits, isVisible);
    return legacy ? { primary: legacy } : {};
  }

  const record: WindowStatesRecord = {};
  const primary = sanitizeWindowState(value.primary, limits, isVisible);
  const secondary = sanitizeWindowState(value.secondary, limits, isVisible);
  if (primary) record.primary = primary;
  if (secondary) record.secondary = secondary;
  return record;
}

/**
 * Replaces one role's geometry, leaving the other untouched. This is the whole
 * point: a secondary window saving its bounds must not erase the primary's.
 */
export function mergeWindowState(
  stored: WindowStatesRecord,
  role: WindowStateRole,
  state: WindowStateBounds,
): WindowStatesRecord {
  return { ...stored, [role]: state };
}

/**
 * The geometry a new window of this role should open with. A secondary window
 * falls back to the primary's size when it has none of its own, so the first
 * detached window is not born at the default size.
 */
export function initialWindowState(
  stored: WindowStatesRecord,
  role: WindowStateRole,
): WindowStateBounds | undefined {
  if (role === 'primary') return stored.primary;
  return stored.secondary ?? stored.primary;
}
