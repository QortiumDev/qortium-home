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

