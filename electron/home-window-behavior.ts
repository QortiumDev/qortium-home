// The two app-level window behaviour settings: what closing the main window
// does, and whether closing it with several tabs open asks first.
//
// These live in their own small file (`window-behavior.json`) rather than in
// the geometry file. `parseWindowStates` treats a flat record with no
// primary/secondary key as one legacy geometry blob, so adding unrelated keys
// alongside the roles would be read back as bounds by any older build that
// still has the flat-record path. A separate store keeps that migration
// untouched.
//
// Free of Electron so the rules can be tested headlessly. File IO lives in
// main.ts next to the geometry IO it mirrors.

export type HomeWindowBehavior = {
  /** Closing the main window hides it to the tray instead of quitting. */
  readonly closeToTray: boolean;
  /** Closing the main window with 2+ tabs open asks for confirmation. */
  readonly warnOnCloseWithMultipleTabs: boolean;
};

export const HOME_WINDOW_BEHAVIOR_SCHEMA = 'qortium-home-window-behavior';
export const HOME_WINDOW_BEHAVIOR_VERSION = 1;

// Off by default: hiding a window that the user asked to close is surprising
// until they opt in. The multi-tab warning is on by default because losing a
// tab strip to one stray click is the loss the warning exists to prevent.
export const DEFAULT_HOME_WINDOW_BEHAVIOR: HomeWindowBehavior = {
  closeToTray: false,
  warnOnCloseWithMultipleTabs: true,
};

const BEHAVIOR_KEYS = ['closeToTray', 'warnOnCloseWithMultipleTabs'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reads the stored record field by field, falling back to the default for
 * anything missing or malformed.
 *
 * Deliberately tolerant rather than strict: a corrupt or half-written
 * behaviour file must never stop Home from opening, and the worst outcome of
 * ignoring a bad field is that one toggle reverts to its default.
 */
export function parseHomeWindowBehavior(value: unknown): HomeWindowBehavior {
  if (!isRecord(value)) return DEFAULT_HOME_WINDOW_BEHAVIOR;

  return {
    closeToTray:
      typeof value.closeToTray === 'boolean'
        ? value.closeToTray
        : DEFAULT_HOME_WINDOW_BEHAVIOR.closeToTray,
    warnOnCloseWithMultipleTabs:
      typeof value.warnOnCloseWithMultipleTabs === 'boolean'
        ? value.warnOnCloseWithMultipleTabs
        : DEFAULT_HOME_WINDOW_BEHAVIOR.warnOnCloseWithMultipleTabs,
  };
}

/** The exact record written to disk, schema-stamped for future migrations. */
export function serializeHomeWindowBehavior(behavior: HomeWindowBehavior) {
  return {
    closeToTray: behavior.closeToTray,
    schema: HOME_WINDOW_BEHAVIOR_SCHEMA,
    version: HOME_WINDOW_BEHAVIOR_VERSION,
    warnOnCloseWithMultipleTabs: behavior.warnOnCloseWithMultipleTabs,
  };
}

/**
 * Validates a renderer-supplied change. Strict, unlike the disk parse: this is
 * untrusted input, so an unknown key or a non-boolean value is refused rather
 * than quietly dropped, and an empty patch is refused too so a no-op write can
 * never look like a successful save.
 */
export function parseHomeWindowBehaviorPatch(value: unknown): Partial<HomeWindowBehavior> {
  if (!isRecord(value)) {
    throw new Error('A window behaviour change must be an object.');
  }

  const keys = Object.keys(value);
  if (keys.length === 0 || keys.length > BEHAVIOR_KEYS.length) {
    throw new Error('A window behaviour change must set one or two known settings.');
  }

  for (const key of keys) {
    if (!(BEHAVIOR_KEYS as readonly string[]).includes(key)) {
      throw new Error('A window behaviour change may only set known settings.');
    }
    if (typeof value[key] !== 'boolean') {
      throw new Error('A window behaviour setting must be a boolean.');
    }
  }

  const patch: { closeToTray?: boolean; warnOnCloseWithMultipleTabs?: boolean } = {};
  if (typeof value.closeToTray === 'boolean') {
    patch.closeToTray = value.closeToTray;
  }
  if (typeof value.warnOnCloseWithMultipleTabs === 'boolean') {
    patch.warnOnCloseWithMultipleTabs = value.warnOnCloseWithMultipleTabs;
  }

  return patch;
}

/** Applies a validated patch, leaving untouched settings alone. */
export function applyHomeWindowBehaviorPatch(
  current: HomeWindowBehavior,
  patch: Partial<HomeWindowBehavior>,
): HomeWindowBehavior {
  return {
    closeToTray: patch.closeToTray ?? current.closeToTray,
    warnOnCloseWithMultipleTabs:
      patch.warnOnCloseWithMultipleTabs ?? current.warnOnCloseWithMultipleTabs,
  };
}
