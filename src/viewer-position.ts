// Presentation only, owned by the open public tab session. Never serialize this
// object or store resources, capabilities, bytes, DOM nodes or playback authority.
export type ViewerPosition = {
  scroll: { top: number; left: number };
  page: number;
  zoom: number;
  mediaTime: number;
  epubCfi?: string;
  archivePath?: string;
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
export function createViewerPositionStore() {
  const tabs = new Map<string, { identity: string; value: ViewerPosition }>();
  return {
    get(id: string, identity: string) {
      let tab = tabs.get(id);
      if (!tab || tab.identity !== identity) {
        tab = { identity, value: createViewerPosition() };
        tabs.set(id, tab);
      }
      return tab.value;
    },
    retain(ids: readonly string[]) {
      const live = new Set(ids);
      for (const id of tabs.keys()) if (!live.has(id)) tabs.delete(id);
    },
  };
}
