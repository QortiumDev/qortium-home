// Pure presentation limits: never fetch URLs or accept app/wallet authority.
export const RICH_PREVIEW_MAX_BYTES = 1024 * 1024
export const RICH_FORMAT_MAX_CHARS = 64 * 1024
export type RichPreviewKind = 'text' | 'code' | 'json' | 'csv' | 'markdown'

export function classifyRichPreview(resource: { filename: string | null; path: string | null; mimeType: string | null; service: string }): RichPreviewKind | null {
  const mime = resource.mimeType?.split(';', 1)[0].trim().toLowerCase() ?? ''
  const ext = (resource.filename || resource.path || '').split('.').pop()?.toLowerCase() ?? ''
  if (['md', 'markdown'].includes(ext) || ['text/markdown', 'text/x-markdown'].includes(mime)) return 'markdown'
  if (ext === 'csv' || mime === 'text/csv') return 'csv'
  if (ext === 'json' || mime === 'application/json' || mime.endsWith('+json') || resource.service === 'JSON') return 'json'
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'java', 'c', 'h', 'cpp', 'cs', 'go', 'rb', 'sh', 'sql', 'css', 'html', 'htm', 'xml', 'yaml', 'yml', 'toml'].includes(ext) || resource.service === 'CODE' || ['application/javascript', 'application/xml'].includes(mime)) return 'code'
  if (['txt', 'log'].includes(ext) || mime.startsWith('text/') || ['TEXT', 'METADATA', 'BLOG', 'BLOG_POST', 'BLOG_COMMENT', 'LIST', 'COMMENT', 'CHAIN_COMMENT', 'MESSAGE'].includes(resource.service)) return 'text'
  return null
}

// Derived from the 1.x quoted-field parser, with bounds during parsing rather
// than slicing an already-unbounded table. A partial final row is never shown.
export function parsePreviewCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false, cells = 0, truncated = false
  const addField = () => {
    if (row.length >= 100 || cells >= 10_000) { truncated = true; return false }
    row.push(field); cells++; field = ''; return true
  }
  const addRow = () => {
    if (rows.length >= 2001) { truncated = true; return false }
    if (row.length > 1 || row[0]) rows.push(row)
    row = []; return true
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') { if (!addField()) break }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      if (!addField() || !addRow()) break
    } else field += char
  }
  if (!truncated && (field.length || row.length)) { if (addField()) addRow() }
  return { rows, truncated }
}

export function parsePreviewJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const value: unknown = JSON.parse(text)
    const pending = [{ value, depth: 0 }]
    let count = 0
    while (pending.length) {
      const item = pending.pop()!
      if (++count > 2000 || item.depth > 24) return { ok: false }
      if (item.value && typeof item.value === 'object') {
        const children = Object.values(item.value)
        if (children.length + count + pending.length > 2000) return { ok: false }
        for (const child of children) pending.push({ value: child, depth: item.depth + 1 })
      }
    }
    return { ok: true, value }
  } catch { return { ok: false } }
}
