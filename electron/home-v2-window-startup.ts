// Pure helpers for Home 2's multi-window support.
//
// Both live here, rather than inside main.ts, because both are correctness
// boundaries worth testing directly: one validates untrusted renderer input
// before it reaches a new window's address route, the other decides what a
// second window is allowed to overwrite in the single shared state file.

const HOME_V2_WINDOW_ADDRESS_MAX_LENGTH = 2048;

// The schemes Home itself can open. `qortal-core` must be listed explicitly:
// it does not match a `qortal` prefix test followed by `://`.
const HOME_V2_WINDOW_ADDRESS_SCHEMES = [
  'home://',
  'qdn://',
  'qortal://',
  'core://',
  'qortal-core://',
];

/**
 * Validates an address handed over from a renderer for a new window.
 *
 * This is untrusted input that becomes the first thing the new window opens,
 * so it is bounded and restricted to Home's own schemes rather than passed
 * through.
 */
export function sanitizeHomeV2WindowAddress(value: unknown): string {
  const address = typeof value === 'string' ? value.trim() : '';
  if (!address || address.length > HOME_V2_WINDOW_ADDRESS_MAX_LENGTH) {
    throw new Error('A window address must be a bounded string.');
  }

  const lowered = address.toLowerCase();
  if (!HOME_V2_WINDOW_ADDRESS_SCHEMES.some((scheme) => lowered.startsWith(scheme))) {
    throw new Error('A window address must use a Home address scheme.');
  }

  return address;
}

/**
 * Produces the record a detached window is allowed to save: everything it
 * sends, except that the stored tab strip is kept.
 *
 * A window opened by dragging a tab out owns a session-only strip. Letting it
 * write that strip would silently destroy the tabs of the window it came from,
 * since Home 2 keeps one shared state file. It must still be able to persist
 * settings, so the two are separated here rather than by refusing the write.
 */
export function mergeHomeV2ShellGlobalState(stored: unknown, next: unknown): unknown {
  if (!next || typeof next !== 'object' || Array.isArray(next)) {
    throw new Error('Home v2 shell state must be an object.');
  }

  const storedProduct =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>).product
      : undefined;

  const merged = { ...(next as Record<string, unknown>) };
  if (storedProduct === undefined) delete merged.product;
  else merged.product = storedProduct;

  return merged;
}
