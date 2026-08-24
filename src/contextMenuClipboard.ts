export async function writeContextMenuClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
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
