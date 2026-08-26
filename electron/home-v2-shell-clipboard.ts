// The Home shell renderer's session denies every permission (see the
// setPermissionRequestHandler in main.ts), which includes 'clipboard-write'.
// navigator.clipboard therefore always rejects there, so the shell's own copy
// actions - the ones in its context menus - have to hand the text to main,
// exactly the way the app-view menus already do.
//
// This is the whole of what main will accept. It is deliberately a pure
// function so the rule can be tested without an Electron process.

/** A copied address, name, or link, not a document. */
export const HOME_V2_SHELL_CLIPBOARD_MAX_LENGTH = 4096;

export function assertHomeV2ShellClipboardText(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > HOME_V2_SHELL_CLIPBOARD_MAX_LENGTH) {
    throw new Error('Clipboard text must be a short string.');
  }

  return value;
}
