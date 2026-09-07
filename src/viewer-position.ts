import type { ViewerPositionSeed } from '../electron/home-v2-viewer-location';

export type { ViewerPositionSeed };

// Presentation only, owned by the open public tab session. Never serialize this
// object or store resources, capabilities, bytes, DOM nodes or playback authority.
export type ViewerPosition = {
  scroll: { top: number; left: number };
  page: number;
  zoom: number;
  mediaTime: number;
  epubCfi?: string;
  archivePath?: string;
  /** A pending opening line, consumed by the first display that can use it. */
  line?: number;
  folders: Record<string, boolean>;
  child?: { path: string; value: ViewerPosition };
};
export const createViewerPosition = (): ViewerPosition => ({
  scroll: { top: 0, left: 0 }, page: 1, zoom: 100, mediaTime: 0,
  folders: Object.create(null) as Record<string, boolean>,
});
export const boundedPosition = (value: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : 0;
export function archiveChildPosition(parent: ViewerPosition | undefined, path: string) {
  if (!parent || path.length > 4096) return undefined;
  if (parent.child?.path !== path) parent.child = { path, value: createViewerPosition() };
  return parent.child.value;
}
/**
 * Copies an address seed onto a freshly created position. Never merged twice.
 * There is no EPUB CFI here: `epubCfi` is only ever written by the reader's own
 * relocated events, never by an address.
 */
export function applyViewerPositionSeed(position: ViewerPosition, seed: ViewerPositionSeed) {
  if (seed.page !== undefined) position.page = seed.page;
  if (seed.zoom !== undefined) position.zoom = seed.zoom;
  if (seed.mediaTime !== undefined) position.mediaTime = seed.mediaTime;
  if (seed.line !== undefined) position.line = seed.line;
  if (seed.archivePath !== undefined) position.archivePath = seed.archivePath;
}

// Opening positions handed from the tab being opened to the position store the
// viewer reads from. Keyed PER TAB: a seed is consumed by that tab's first read,
// discarded when the tab is no longer retained, and never evicted by another
// tab's open, so a burst of seeded opens of any size all land. No size cap: a
// record is always followed by the tab's dispatch, and `retain()` runs with the
// live viewer ids, so the map is bounded by the number of open viewer tabs.
const pendingSeeds = new Map<string, { identity: string; seed: ViewerPositionSeed }>();
// The identity each tab's position was last handed out under. A seed recorded
// after that read is already too late for the reader that asked, so it is
// dropped outright rather than left pending to revive on a later clear/reset.
const readIdentities = new Map<string, string>();

export function recordViewerPositionSeed(tabId: string, identity: string, seed: ViewerPositionSeed | null) {
  pendingSeeds.delete(tabId);
  if (!seed || readIdentities.get(tabId) === identity) return;
  pendingSeeds.set(tabId, { identity, seed });
}

export function createViewerPositionStore() {
  const tabs = new Map<string, { identity: string; value: ViewerPosition }>();
  return {
    get(id: string, identity: string) {
      let tab = tabs.get(id);
      if (!tab || tab.identity !== identity) {
        tab = { identity, value: createViewerPosition() };
        tabs.set(id, tab);
        // Exactly once per opened tab: taken here whatever it matched, so a
        // tab that changed resource or account before its first read drops the
        // seed instead of applying an address position to something else.
        const pending = pendingSeeds.get(id);
        if (pending) {
          pendingSeeds.delete(id);
          if (pending.identity === identity) applyViewerPositionSeed(tab.value, pending.seed);
        }
      }
      readIdentities.set(id, identity);
      return tab.value;
    },
    retain(ids: readonly string[]) {
      const live = new Set(ids);
      for (const id of tabs.keys()) if (!live.has(id)) tabs.delete(id);
      // A closed tab's unread seed dies with it: it must never survive to be
      // applied to some later tab that happens to reuse the id.
      for (const id of pendingSeeds.keys()) if (!live.has(id)) pendingSeeds.delete(id);
      for (const id of readIdentities.keys()) if (!live.has(id)) readIdentities.delete(id);
    },
  };
}
