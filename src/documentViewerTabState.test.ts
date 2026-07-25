import assert from 'node:assert/strict';
import {
  isTabScopedDocumentViewerVisible,
  shouldClearTabScopedDocumentViewer,
  shouldDismissDocumentViewerBeforeNavigating,
  shouldSuspendQdnTabForDocumentViewer,
  type TabScopedDocumentViewer,
} from './documentViewerTabState.js';

const viewer: TabScopedDocumentViewer<{ resource: string }> = {
  tabId: 'explore',
  value: { resource: 'qdn://DOCUMENT/example/doc.pdf' },
};

assert.equal(isTabScopedDocumentViewerVisible(viewer, 'explore'), true);
assert.equal(
  isTabScopedDocumentViewerVisible(viewer, 'library'),
  false,
  'a reader does not cover a different selected tab',
);
assert.equal(
  isTabScopedDocumentViewerVisible(viewer, 'explore'),
  true,
  'returning to its owner restores the same reader',
);
assert.equal(
  shouldDismissDocumentViewerBeforeNavigating(viewer, 'explore'),
  true,
  'Back closes the reader before changing the owner tab history',
);
assert.equal(
  shouldDismissDocumentViewerBeforeNavigating(viewer, 'library'),
  false,
  'a different selected tab keeps its own Back behavior',
);
assert.equal(
  shouldClearTabScopedDocumentViewer(viewer, ['library']),
  true,
  'closing the owner clears its reader state',
);
assert.equal(
  shouldClearTabScopedDocumentViewer(viewer, ['explore', 'library']),
  false,
  'closing an unrelated tab preserves the reader',
);

assert.equal(
  shouldSuspendQdnTabForDocumentViewer({
    activeTabId: 'explore',
    globallySuspended: false,
    tabId: 'explore',
    viewer,
  }),
  true,
  'the owner app is suspended behind its reader',
);
assert.equal(
  shouldSuspendQdnTabForDocumentViewer({
    activeTabId: 'library',
    globallySuspended: false,
    tabId: 'library',
    viewer,
  }),
  false,
  'a selected non-owner QDN tab remains interactive',
);
assert.equal(
  shouldSuspendQdnTabForDocumentViewer({
    activeTabId: 'library',
    globallySuspended: false,
    tabId: 'explore',
    viewer,
  }),
  true,
  'the background owner tab stays suspended',
);
assert.equal(
  shouldSuspendQdnTabForDocumentViewer({
    activeTabId: 'library',
    globallySuspended: true,
    tabId: 'library',
    viewer,
  }),
  true,
  'existing global suspension still takes priority',
);

console.log('Document viewer tab state tests passed.');
