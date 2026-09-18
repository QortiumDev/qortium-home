import type { WebContents } from 'electron';

/**
 * Developer tools for Home 2.
 *
 * Home never disables devtools (the main window and every app view keep
 * Electron's default), but nothing used to expose them: the application menu
 * is a custom, translated one with no toggleDevTools role. Hub gets
 * Ctrl+Shift+I / F12 from Electron's stock View menu, and testers expected the
 * same here. The stock role would be wrong for Home 2, though: apps live in
 * their own WebContentsViews, so it would only ever open the SHELL renderer's
 * tools, never the app the user is looking at.
 *
 * "This tab" therefore resolves through the window's app views. The shell
 * shows at most one app view per window (switching tabs hides the previous
 * one, and a trusted prompt hides it too), so the visible, live view IS the
 * active tab. When no app view is visible the active tab is something the
 * shell renders itself (dashboard, settings, a viewer page), and the shell
 * renderer's tools are the right target.
 *
 * Pure over a small candidate model so the choice is unit-testable without
 * Electron; qdn-views supplies the candidates and main.ts does the toggling.
 */

export type DeveloperToolsScope = 'home' | 'tab';

export interface DeveloperToolsViewCandidate {
  readonly destroyed: boolean;
  readonly tabId: string;
  readonly visible: boolean;
}

export type DeveloperToolsTarget<T extends DeveloperToolsViewCandidate> =
  | { readonly kind: 'app-view'; readonly view: T }
  | { readonly kind: 'shell' };

/** The one app view a window currently shows, or null when it shows none. */
export function pickDeveloperToolsTabView<T extends DeveloperToolsViewCandidate>(
  views: readonly T[],
): T | null {
  return views.find((view) => view.visible && !view.destroyed) ?? null;
}

export function resolveDeveloperToolsTarget<T extends DeveloperToolsViewCandidate>(
  scope: DeveloperToolsScope,
  views: readonly T[],
): DeveloperToolsTarget<T> {
  if (scope === 'home') {
    return { kind: 'shell' };
  }

  const view = pickDeveloperToolsTabView(views);
  return view ? { kind: 'app-view', view } : { kind: 'shell' };
}

/**
 * Toggles the tools for one webContents. Detached rather than docked: a docked
 * panel would resize the shell renderer underneath the app views, whose bounds
 * the shell lays out itself, and an app view has no window of its own to dock
 * into. Returns whether the tools are open afterwards.
 */
export function toggleWebContentsDevTools(webContents: WebContents): boolean {
  if (webContents.isDestroyed()) {
    return false;
  }

  if (webContents.isDevToolsOpened()) {
    webContents.closeDevTools();
    return false;
  }

  webContents.openDevTools({ mode: 'detach' });
  return true;
}
