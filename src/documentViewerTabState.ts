/**
 * The document reader belongs to the tab that opened it. Keeping this policy
 * separate from App makes it explicit that another selected tab must remain
 * usable while a reader is open in the background.
 */
export type TabScopedDocumentViewer<T> = {
  tabId: string;
  value: T;
};

export function isTabScopedDocumentViewerVisible<T>(
  viewer: TabScopedDocumentViewer<T> | null,
  activeTabId: string,
) {
  return viewer?.tabId === activeTabId;
}

/** Back closes the reader first, leaving the tab's route history untouched. */
export function shouldDismissDocumentViewerBeforeNavigating<T>(
  viewer: TabScopedDocumentViewer<T> | null,
  activeTabId: string,
) {
  return isTabScopedDocumentViewerVisible(viewer, activeTabId);
}

export function shouldClearTabScopedDocumentViewer<T>(
  viewer: TabScopedDocumentViewer<T> | null,
  openTabIds: readonly string[],
) {
  return viewer !== null && !openTabIds.includes(viewer.tabId);
}

export function shouldSuspendQdnTabForDocumentViewer<T>({
  activeTabId,
  globallySuspended,
  tabId,
  viewer,
}: {
  activeTabId: string;
  globallySuspended: boolean;
  tabId: string;
  viewer: TabScopedDocumentViewer<T> | null;
}) {
  return globallySuspended || tabId !== activeTabId || viewer?.tabId === tabId;
}
