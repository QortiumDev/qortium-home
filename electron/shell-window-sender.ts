// Sensitive IPC surfaces belong to Home's own shell UI. Preload topology
// decides which renderer sees an API, but a compromised renderer is not bound
// by its preload, so the main process re-checks the sender: it must be a Home
// window's webContents and explicitly not a QDN app view.

import { BrowserWindow, type WebContents } from 'electron';
import { isTrustedQdnAppRolesSender } from './qdn-manager-permissions.js';
import { getQdnViewContextForWebContents } from './qdn-views.js';

export function assertShellWindowSender(sender: WebContents, refusal: string) {
  const trusted = isTrustedQdnAppRolesSender({
    senderId: sender.id,
    isQdnView: getQdnViewContextForWebContents(sender) !== null,
    shellWindowWebContentsIds: BrowserWindow.getAllWindows()
      .filter((window) => !window.isDestroyed())
      .map((window) => window.webContents.id),
  });

  if (!trusted) throw new Error(refusal);
}
