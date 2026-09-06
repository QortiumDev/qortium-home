// Pure helpers for Home 2's multi-window support.
//
// Both live here, rather than inside main.ts, because both are correctness
// boundaries worth testing directly: one validates untrusted renderer input
// before it reaches a new window's address route, the other decides what a
// second window is allowed to overwrite in the single shared state file.

/**
 * The address bound, which MUST equal the renderer's own: 2,000 characters, in
 * `validateCustomNewTabAddress` (src/v2/new-tab-preference.ts).
 *
 * A transfer is validated twice — here, and again by the receiving renderer —
 * and the sending tab is closed as soon as main accepts. A main bound that is
 * larger than the renderer's therefore loses tabs: main says yes, the source
 * closes, and the receiver then refuses the address. Exported so the test can
 * pin the exact boundary rather than a rounded one.
 */
export const HOME_V2_WINDOW_ADDRESS_MAX_LENGTH = 2000;

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
 * The revision of the tab-transfer envelope this build sends.
 *
 * Revision 1 was a bare address string. It is still ACCEPTED, so a payload
 * from an older shape degrades to the historical "open it under whatever
 * account this window has selected" behaviour instead of failing.
 */
export const HOME_V2_TAB_TRANSFER_REVISION = 2;

// Matches the persisted account-id bound in the bookmark/product model, so a
// transferable account id can never be larger than a storable one.
const HOME_V2_TAB_TRANSFER_ACCOUNT_ID_MAX_LENGTH = 400;
// Deliberately looser than the renderer's 160-character app-title cap
// (sanitizeHomeV2AppTitle, src/v2/app-frame-messages.ts). It cannot be shared:
// electron/tsconfig.json compiles `electron/*` with rootDir '.', so src/ is not
// importable from here. Unlike the address bound this mismatch cannot lose a
// tab — a title is display-only, is re-sanitised on the receiving side, and is
// never a reason to refuse an open — so main only has to keep it bounded.
const HOME_V2_TAB_TRANSFER_TITLE_MAX_LENGTH = 512;
const HOME_V2_TAB_TRANSFER_HISTORY_MAX_ENTRIES = 50;

export interface HomeV2TabTransferHistoryEntry {
  address: string;
  title?: string;
}

export interface HomeV2TabTransferHistory {
  entries: HomeV2TabTransferHistoryEntry[];
  index: number;
}

/**
 * What a tab is while it is between two windows.
 *
 * Deliberately nothing but addresses and one opaque account identifier: the
 * receiving window re-validates all of it and re-opens the tab through its
 * ordinary open path, so no vault, grant, unlock, preview capability, viewer
 * position, DOM or native-webview history state has to survive the trip.
 */
export type HomeV2TabTransfer =
  | { revision: 1; address: string }
  | {
      revision: 2;
      address: string;
      /** The persisted guest sentinel ('home-v2:guest') or a Home account id. */
      accountId: string;
      title?: string;
      history?: HomeV2TabTransferHistory;
    };

function isTransferRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeTabTransferAccountId(value: unknown): string {
  const accountId = typeof value === 'string' ? value.trim() : '';
  if (!accountId || accountId.length > HOME_V2_TAB_TRANSFER_ACCOUNT_ID_MAX_LENGTH) {
    throw new Error('A tab transfer must name a bounded account id.');
  }
  return accountId;
}

// Display only, and never a reason to lose the tab: a title that is absent,
// empty or not a string is simply not carried, and a long one is trimmed.
function sanitizeTabTransferTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const title = value.trim().slice(0, HOME_V2_TAB_TRANSFER_TITLE_MAX_LENGTH);
  return title || undefined;
}

function sanitizeTabTransferHistory(value: unknown): HomeV2TabTransferHistory | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isTransferRecord(value) || !Array.isArray(value.entries)) {
    throw new Error('A tab transfer history must be an object with entries.');
  }
  const source = value.entries;
  if (source.length === 0 || source.length > HOME_V2_TAB_TRANSFER_HISTORY_MAX_ENTRIES) {
    throw new Error(
      `A tab transfer history must hold 1 to ${HOME_V2_TAB_TRANSFER_HISTORY_MAX_ENTRIES} entries.`,
    );
  }
  const index = value.index;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= source.length) {
    throw new Error('A tab transfer history index must point at one of its entries.');
  }
  const entries = source.map((entry) => {
    if (!isTransferRecord(entry)) {
      throw new Error('A tab transfer history entry must be an object.');
    }
    const address = sanitizeHomeV2WindowAddress(entry.address);
    if (entry.title !== undefined && typeof entry.title !== 'string') {
      throw new Error('A tab transfer history entry title must be a string.');
    }
    const title = sanitizeTabTransferTitle(entry.title);
    return title === undefined ? { address } : { address, title };
  });
  return { entries, index };
}

/**
 * Validates the payload a renderer hands over when a tab moves to another
 * window, and returns a FRESH object holding only the fields Home names.
 *
 * Everything here is untrusted: it comes from one renderer and is handed to a
 * different one, so the whole envelope is rebuilt rather than forwarded, every
 * address goes through the same scheme allow-list a new window's first address
 * does, and every bound is enforced here rather than trusted from the sender.
 * Unknown fields (a preview URL, a native history session, anything a future
 * build might add) are dropped.
 */
export function sanitizeHomeV2TabTransfer(value: unknown): HomeV2TabTransfer {
  // The historical payload: a bare address, with no account and no history.
  if (typeof value === 'string') {
    return { revision: 1, address: sanitizeHomeV2WindowAddress(value) };
  }
  if (!isTransferRecord(value)) {
    throw new Error('A tab transfer must be an address or an envelope object.');
  }
  const address = sanitizeHomeV2WindowAddress(value.address);
  if (value.revision === 1) return { revision: 1, address };
  if (value.revision !== HOME_V2_TAB_TRANSFER_REVISION) {
    throw new Error('A tab transfer must use a supported revision.');
  }

  const transfer: HomeV2TabTransfer = {
    revision: 2,
    address,
    accountId: sanitizeTabTransferAccountId(value.accountId),
  };
  const title = sanitizeTabTransferTitle(value.title);
  if (title !== undefined) transfer.title = title;
  const history = sanitizeTabTransferHistory(value.history);
  if (history !== undefined) transfer.history = history;
  return transfer;
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
