export type QdnAppNavigationEntry = {
  index: number;
  url: string;
};

export type QdnAppNavigationSnapshot = {
  activeIndex: number;
  entries: QdnAppNavigationEntry[];
};

export type QdnAppHistorySession = {
  activeIndex: number;
  displayUrls: string[];
  entries: QdnAppNavigationEntry[];
  resourceUrl: string;
  startIndex: number;
};

export type QdnAppHistoryMerge = {
  displayUrls: string[];
  historyIndex: number;
  session: QdnAppHistorySession;
  truncateForward: boolean;
};

export function spliceQdnAppHistory<T>({
  currentEntries,
  merge,
  nextAppEntries,
  previousSessionLength,
}: {
  currentEntries: T[];
  merge: QdnAppHistoryMerge;
  nextAppEntries: T[];
  previousSessionLength: number;
}) {
  const sessionEnd = merge.session.startIndex + Math.max(1, previousSessionLength);
  const suffix = merge.truncateForward ? [] : currentEntries.slice(sessionEnd);
  const entries = [
    ...currentEntries.slice(0, merge.session.startIndex),
    ...nextAppEntries,
    ...suffix,
  ];

  return {
    entries,
    index: Math.max(0, Math.min(entries.length - 1, merge.historyIndex)),
  };
}

function sameEntries(first: QdnAppNavigationEntry[], second: QdnAppNavigationEntry[]) {
  return first.length === second.length && first.every((entry, index) => {
    const candidate = second[index];
    return candidate?.index === entry.index && candidate.url === entry.url;
  });
}

function isReplacement(
  previous: QdnAppHistorySession,
  entries: QdnAppNavigationEntry[],
  activeIndex: number,
) {
  if (previous.entries.length !== entries.length || previous.activeIndex !== activeIndex) {
    return false;
  }

  let changedEntries = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const previousEntry = previous.entries[index];
    const nextEntry = entries[index];

    if (previousEntry?.index !== nextEntry?.index || previousEntry.url !== nextEntry.url) {
      changedEntries += 1;

      if (nextEntry?.index !== activeIndex) {
        return false;
      }
    }
  }

  return changedEntries === 1;
}

/**
 * Merge the embedded browser's history into Home's tab history. The embedded
 * engine remains authoritative while it is alive, but Home mirrors every entry
 * so all host navigation controls and tab snapshots see the same pages.
 */
export function mergeQdnAppHistory({
  currentHistoryIndex,
  displayUrls,
  entries,
  previous,
  resourceUrl,
  activeIndex,
}: {
  activeIndex: number;
  currentHistoryIndex: number;
  displayUrls: string[];
  entries: QdnAppNavigationEntry[];
  previous?: QdnAppHistorySession;
  resourceUrl: string;
}): QdnAppHistoryMerge | null {
  if (
    entries.length === 0 ||
    entries.length !== displayUrls.length ||
    !entries.some((entry) => entry.index === activeIndex)
  ) {
    return null;
  }

  if (!previous || previous.resourceUrl !== resourceUrl) {
    const activePosition = entries.findIndex((entry) => entry.index === activeIndex);
    // Home's current outer entry is always the first page in a newly observed
    // app session. The embedded engine may already have pushed more pages before
    // its first snapshot reaches us, so do not subtract its active position.
    const startIndex = Math.max(0, currentHistoryIndex);

    return {
      displayUrls,
      historyIndex: startIndex + activePosition,
      session: {
        activeIndex,
        displayUrls,
        entries,
        resourceUrl,
        startIndex,
      },
      // A first one-entry snapshot is the page Home just loaded. A restored
      // multi-entry engine already owns its forward stack, so mirror it fully.
      truncateForward: entries.length > 1,
    };
  }

  const activePosition = entries.findIndex((entry) => entry.index === activeIndex);
  const isTraversal = sameEntries(previous.entries, entries);
  const replace = isReplacement(previous, entries, activeIndex);

  return {
    displayUrls,
    historyIndex: previous.startIndex + activePosition,
    session: {
      activeIndex,
      displayUrls,
      entries,
      resourceUrl,
      startIndex: previous.startIndex,
    },
    // Traversal and replaceState retain the outer forward stack. A changed
    // history shape is a push/new navigation and has browser-standard truncation.
    truncateForward: !isTraversal && !replace,
  };
}
