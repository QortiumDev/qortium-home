declare global {
  interface Window {
    homeV2Clipboard?: {
      copyText(value: string): Promise<void>
    }
  }
}

// Copy for the shell's own context menus (addresses, names, links).
//
// Order matters. On desktop the Home shell renderer runs in a session that
// denies every permission request, so navigator.clipboard.writeText always
// rejects there however the page was interacted with; the bridge writes the
// text in main instead, which is where the app-view menus already copy from.
// Android has no bridge and a working navigator.clipboard, so it keeps that
// path. The textarea/execCommand fallback is last, and it is only reachable
// because the navigator attempt is now wrapped: its rejection used to escape
// this function before the fallback could run.
export async function writeContextMenuClipboard(value: string) {
  const bridge = window.homeV2Clipboard
  if (bridge && typeof bridge.copyText === 'function') {
    await bridge.copyText(value)
    return
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Fall through to the selection-based copy below.
    }
  }
  const textArea = document.createElement('textarea')
  textArea.value = value
  textArea.style.position = 'fixed'
  textArea.style.opacity = '0'
  document.body.append(textArea)
  textArea.focus()
  textArea.select()
  try {
    if (!document.execCommand('copy')) throw new Error('Clipboard copy is unavailable.')
  } finally {
    textArea.remove()
  }
}
