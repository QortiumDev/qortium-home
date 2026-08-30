import type { IpcMainInvokeEvent, WebContents } from 'electron'

type AuthorizedHomeV2Sender = {
  readonly sender: WebContents
  readonly trustedDocumentUrl: string
}

const authorizedHomeV2Senders = new Map<number, AuthorizedHomeV2Sender>()

function normalizedDocumentUrl(value: string) {
  try {
    return new URL(value).href
  } catch {
    return null
  }
}

function revokeHomeV2Sender(sender: WebContents) {
  const authorized = authorizedHomeV2Senders.get(sender.id)
  if (authorized?.sender === sender) authorizedHomeV2Senders.delete(sender.id)
}

export function authorizeHomeV2Sender(
  sender: WebContents,
  trustedDocumentUrl: string,
) {
  const normalizedTrustedUrl = normalizedDocumentUrl(trustedDocumentUrl)
  if (!normalizedTrustedUrl) {
    throw new Error('The trusted Home v2 document URL is invalid.')
  }

  authorizedHomeV2Senders.set(sender.id, {
    sender,
    trustedDocumentUrl: normalizedTrustedUrl,
  })
  sender.once('destroyed', () => revokeHomeV2Sender(sender))
  sender.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
    if (
      isMainFrame &&
      normalizedDocumentUrl(url) !== normalizedTrustedUrl
    ) {
      revokeHomeV2Sender(sender)
    }
  })
}

export function assertAuthorizedHomeV2Sender(event: IpcMainInvokeEvent) {
  const { sender, senderFrame } = event
  const authorized = authorizedHomeV2Senders.get(sender.id)
  const senderUrl = normalizedDocumentUrl(sender.getURL())
  const frameUrl = senderFrame ? normalizedDocumentUrl(senderFrame.url) : null

  if (
    !authorized ||
    authorized.sender !== sender ||
    sender.isDestroyed() ||
    !senderFrame ||
    senderFrame !== sender.mainFrame ||
    senderUrl !== authorized.trustedDocumentUrl ||
    frameUrl !== authorized.trustedDocumentUrl
  ) {
    throw new Error(
      'Home v2 data is only available to an authorized top-level Home v2 document.',
    )
  }
}

/**
 * Delivers to one registered sender, revoking it if it has been destroyed or
 * has navigated away from its trusted document. Returns whether it landed.
 */
function deliverToHomeV2Sender(
  senderId: number,
  channel: string,
  value: unknown,
): boolean {
  const authorized = authorizedHomeV2Senders.get(senderId)
  if (!authorized) return false

  const { sender, trustedDocumentUrl } = authorized
  // Destroyed is permanent, so forgetting it is right.
  if (sender.isDestroyed()) {
    authorizedHomeV2Senders.delete(senderId)
    return false
  }
  // Not showing the trusted document is NOT permanent, and this used to delete
  // the grant for it. During startup `getURL()` has not committed yet, so any
  // broadcast landing in that window -- settings, policy, anything global --
  // silently revoked a window that went on to load correctly, leaving its
  // bridge dead for the life of the process. The renderer then shows
  // "Home v2 data is only available to an authorized top-level Home v2
  // document" with no way back.
  //
  // That is what made a normally-launched AppImage unusable while the same
  // build worked under APPIMAGE_EXTRACT_AND_RUN: the FUSE mount starts slower,
  // so a broadcast fell inside the loading window.
  //
  // Skipping this delivery is enough. A window that genuinely navigates away is
  // revoked by the did-start-navigation hook, and a destroyed one is handled
  // above -- both permanent conditions, unlike this one.
  if (normalizedDocumentUrl(sender.getURL()) !== trustedDocumentUrl) {
    return false
  }

  try {
    sender.send(channel, value)
    return true
  } catch (error) {
    // Left as-is deliberately. A throwing send revokes, which is fail-closed and
    // has its own test; loosening it is a separate decision from the startup
    // race fixed above, and not one this change needs to make.
    authorizedHomeV2Senders.delete(senderId)
    console.warn('Unable to notify an authorized Home 2 sender.', error)
    return false
  }
}

/**
 * Sends to EVERY Home 2 window. Correct only for state that is genuinely
 * global — settings, policy — because Home 2 can have more than one window
 * open since tabs became detachable. Anything window-specific belongs in
 * `sendToHomeV2Window`, or it reaches windows it was never meant for.
 */
export function broadcastToHomeV2Windows(channel: string, value: unknown) {
  for (const senderId of [...authorizedHomeV2Senders.keys()]) {
    deliverToHomeV2Sender(senderId, channel, value)
  }
}

/**
 * Sends to a single Home 2 window, identified by its webContents id — the same
 * id the app bridge stores as `hostWebContentsId` when it records which window
 * asked for something. Returns false when that window is gone or is no longer
 * showing its trusted document.
 */
export function sendToHomeV2Window(
  webContentsId: number,
  channel: string,
  value: unknown,
): boolean {
  return deliverToHomeV2Sender(webContentsId, channel, value)
}
