// What closing the main Home window should actually do.
//
// Three settings-and-state combinations decide it — a quit already in
// progress, close-to-tray, and the multi-tab warning — and getting the order
// wrong is how a close-to-tray build becomes impossible to quit. The rules and
// the dialog shape therefore live here, free of Electron, so every combination
// can be asserted headlessly. main.ts owns only the BrowserWindow calls.
//
// The dialog strings are plain English constants, like the tray labels in
// tray-menu.ts: main-process chrome is not part of the renderer's i18n bundle.

export type HomeWindowCloseRole = 'primary' | 'secondary';

export type HomeCloseContext = {
  /** The setting: hide to the tray instead of closing. */
  readonly closeToTray: boolean;
  /**
   * This window already resolved a prompt (or was asked to close by the
   * dialog's own answer). Without this the confirmed close re-enters the
   * handler and prompts again, forever.
   */
  readonly confirmed: boolean;
  /** A quit is in progress, so nothing may keep the app alive. */
  readonly quitting: boolean;
  /** Only the primary window carries app-level close behaviour. */
  readonly role: HomeWindowCloseRole;
  /** Tabs open in this window, from the last shell state it saved. */
  readonly tabCount: number;
  /** A tray icon actually exists to restore a hidden window from. */
  readonly trayAvailable: boolean;
  /** The setting: ask before closing a window with several tabs. */
  readonly warnOnMultipleTabs: boolean;
};

export type HomeCloseAction = 'cancel' | 'close' | 'hide';

export type HomeCloseDialog = {
  /** Which action each button index maps to. Index-aligned with `buttons`. */
  readonly actions: readonly HomeCloseAction[];
  readonly buttons: readonly string[];
  readonly cancelId: number;
  readonly checkboxLabel: string;
  readonly defaultId: number;
  readonly detail: string;
  readonly message: string;
  readonly title: string;
  readonly type: 'question';
};

export type HomeClosePlan =
  /** Let the close proceed. */
  | { readonly kind: 'close' }
  /** Cancel the close and hide the window to the tray. */
  | { readonly kind: 'hide' }
  /** Cancel the close and ask, then act on `resolveHomeCloseDialog`. */
  | { readonly kind: 'prompt'; readonly dialog: HomeCloseDialog };

export type HomeCloseOutcome = {
  readonly action: HomeCloseAction;
  /**
   * The settings change the "Remember my choice" checkbox asked for, or null.
   * Only ever a change the user's own answer implies — see the mapping note on
   * `resolveHomeCloseDialog`.
   */
  readonly settings:
    | { readonly closeToTray: true }
    | { readonly warnOnCloseWithMultipleTabs: false }
    | null;
};

export const HOME_CLOSE_DIALOG_TITLE = 'Close Qortium Home';
export const HOME_CLOSE_DIALOG_CHECKBOX_LABEL = 'Remember my choice';
export const HOME_CLOSE_DIALOG_CLOSE_BUTTON = 'Close window';
export const HOME_CLOSE_DIALOG_HIDE_BUTTON = 'Close to tray';
export const HOME_CLOSE_DIALOG_CANCEL_BUTTON = 'Cancel';

/** The number of open tabs below which the warning is pointless. */
export const HOME_CLOSE_WARNING_MIN_TABS = 2;

export function homeCloseDialog(tabCount: number, trayAvailable: boolean): HomeCloseDialog {
  const buttons = [HOME_CLOSE_DIALOG_CLOSE_BUTTON];
  const actions: HomeCloseAction[] = ['close'];

  // Offered only when there is a tray to restore from. Without one, "Close to
  // tray" would hide the window with no way back to it.
  if (trayAvailable) {
    buttons.push(HOME_CLOSE_DIALOG_HIDE_BUTTON);
    actions.push('hide');
  }

  buttons.push(HOME_CLOSE_DIALOG_CANCEL_BUTTON);
  actions.push('cancel');

  const cancelId = buttons.length - 1;

  return {
    actions,
    buttons,
    cancelId,
    checkboxLabel: HOME_CLOSE_DIALOG_CHECKBOX_LABEL,
    // Cancel-safe: Enter, Escape and a dismissed dialog all keep the tabs.
    // Losing a tab strip to a reflexive keypress is exactly what this asks
    // about, so the safe answer is the one under the user's fingers.
    defaultId: cancelId,
    detail: trayAvailable
      ? 'Closing this window closes all of its tabs. You can keep Qortium Home running in the tray instead.'
      : 'Closing this window closes all of its tabs.',
    message: tabCount === 1 ? 'Close 1 tab?' : `Close ${tabCount} tabs?`,
    title: HOME_CLOSE_DIALOG_TITLE,
    type: 'question',
  };
}

/**
 * Decides what a close event should do.
 *
 * The order is the whole point:
 *
 * 1. A quit in progress always closes. Nothing below may keep the app alive,
 *    or Quit becomes unable to quit.
 * 2. A confirmed close always closes, so the close issued by the dialog's own
 *    answer does not re-prompt.
 * 3. Secondary and detached windows always close: their tab strip is
 *    session-only and the app-level behaviour is the main window's.
 * 4. Close-to-tray hides — but only when a tray exists to restore from.
 * 5. Otherwise the multi-tab warning asks, if it is on and there is more than
 *    one tab to lose.
 */
export function planHomeClose(context: HomeCloseContext): HomeClosePlan {
  if (context.quitting || context.confirmed || context.role !== 'primary') {
    return { kind: 'close' };
  }

  if (context.closeToTray && context.trayAvailable) {
    return { kind: 'hide' };
  }

  if (context.warnOnMultipleTabs && context.tabCount >= HOME_CLOSE_WARNING_MIN_TABS) {
    return { kind: 'prompt', dialog: homeCloseDialog(context.tabCount, context.trayAvailable) };
  }

  return { kind: 'close' };
}

/**
 * Turns a dialog answer into an action and, when "Remember my choice" was
 * ticked, the setting that answer implies.
 *
 * The mapping only ever turns the chosen action into its own setting:
 *
 * - "Close window" + remember -> stop warning (`warnOnCloseWithMultipleTabs`
 *   false). The user has said closing everything is what they meant.
 * - "Close to tray" + remember -> always close to tray (`closeToTray` true).
 *   That setting also supersedes the warning, since the tabs survive.
 * - "Cancel" + remember -> nothing. A cancelled close expresses no preference,
 *   and silently recording one from a dialog the user backed out of would be
 *   the worst possible surprise.
 *
 * An out-of-range or missing response index is treated as Cancel: an unknown
 * answer must never close anything.
 */
export function resolveHomeCloseDialog(
  dialog: HomeCloseDialog,
  response: { readonly response: number; readonly checkboxChecked?: boolean },
): HomeCloseOutcome {
  const index = response.response;
  const action =
    Number.isInteger(index) && index >= 0 && index < dialog.actions.length
      ? dialog.actions[index]
      : 'cancel';

  if (response.checkboxChecked !== true || action === 'cancel') {
    return { action, settings: null };
  }

  return action === 'hide'
    ? { action, settings: { closeToTray: true } }
    : { action, settings: { warnOnCloseWithMultipleTabs: false } };
}

/**
 * The primary window's tab count, taken from the shell state the renderer last
 * saved rather than asked for over IPC — a close event cannot wait for an
 * answer.
 *
 * The renderer saves on every tab change, so this is current except during the
 * moments between opening a tab and that save landing; a close in that window
 * can undercount by one, which at worst skips a warning the user would have
 * seen. Anything unrecognisable counts as no tabs, which also skips the
 * warning rather than inventing one.
 */
export function homeV2TabCount(shellState: unknown): number {
  if (!shellState || typeof shellState !== 'object' || Array.isArray(shellState)) return 0;

  const product = (shellState as Record<string, unknown>).product;
  if (!product || typeof product !== 'object' || Array.isArray(product)) return 0;

  const entries = (product as Record<string, unknown>).entries;
  return Array.isArray(entries) ? entries.length : 0;
}
