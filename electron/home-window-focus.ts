// Which Home window the user touched last.
//
// The tray's "Open Home" used to raise the first window in creation order,
// which with more than one window is arbitrary — it can surface the one behind
// the window you were just using. Electron does not track focus history, so
// Home keeps its own.
//
// Deliberately free of Electron types: it stores window ids only, so the
// ordering rules can be tested without a display.

export interface HomeWindowFocusTracker {
  /** Records a window as the most recently focused. */
  note(windowId: number): void;
  /** Drops a closed window, so it can never be chosen again. */
  forget(windowId: number): void;
  /**
   * The most recently focused of `candidateIds`, or null when none of them has
   * ever been focused — callers then fall back to their own choice rather than
   * being handed an arbitrary one.
   */
  mostRecent(candidateIds: readonly number[]): number | null;
}

export function createHomeWindowFocusTracker(): HomeWindowFocusTracker {
  // Least recent first, so the newest focus is always the last element.
  const focusOrder: number[] = [];

  const drop = (windowId: number) => {
    const index = focusOrder.indexOf(windowId);
    if (index >= 0) focusOrder.splice(index, 1);
  };

  return {
    forget: drop,
    mostRecent(candidateIds) {
      const candidates = new Set(candidateIds);
      for (let index = focusOrder.length - 1; index >= 0; index--) {
        const windowId = focusOrder[index];
        if (candidates.has(windowId)) return windowId;
      }
      return null;
    },
    note(windowId) {
      drop(windowId);
      focusOrder.push(windowId);
    },
  };
}

/** The tracker Home itself uses; tests build their own. */
export const homeWindowFocus = createHomeWindowFocusTracker();
