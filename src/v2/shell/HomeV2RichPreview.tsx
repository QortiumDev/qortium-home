import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { marked, type Token } from 'marked'
import { t } from '../../i18n'
import { parsePreviewCsv, parsePreviewJson, RICH_FORMAT_MAX_CHARS, RICH_PREVIEW_MAX_BYTES, type RichPreviewKind } from './rich-preview'

// Convert only known Markdown tokens into React elements. No HTML injection,
// srcDoc, URL attributes, network loads, or bridge access. Publisher HTML is text.
export function renderPreviewMarkdown(text: string): ReactNode {
  if (text.length > RICH_FORMAT_MAX_CHARS) throw new Error('Formatting limit')
  let count = 0
  const render = (tokens: Token[], depth = 0): ReactNode => {
    // Count empty table cells too, not just tokens with visible text.
    if (++count > 4000 || depth > 24) throw new Error('Formatting limit')
    return tokens.map((token, index) => {
    if (++count > 4000) throw new Error('Formatting limit')
    const children = () => render('tokens' in token ? token.tokens ?? [] : [], depth + 1)
    let node: ReactNode
    switch (token.type) {
      case 'space': node = null; break
      case 'heading': {
        const tags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const
        const Tag = tags[Math.min(5, Math.max(0, token.depth - 1))]
        node = <Tag>{children()}</Tag>; break
      }
      case 'paragraph': node = <p>{children()}</p>; break
      case 'text': node = 'tokens' in token && token.tokens ? children() : token.text; break
      case 'escape': node = token.text; break
      case 'strong': node = <strong>{children()}</strong>; break
      case 'em': node = <em>{children()}</em>; break
      case 'del': node = <del>{children()}</del>; break
      case 'codespan': node = <code>{token.text}</code>; break
      case 'code': node = <pre><code>{token.text}</code></pre>; break
      case 'blockquote': node = <blockquote>{children()}</blockquote>; break
      case 'br': node = <br />; break
      case 'hr': node = <hr />; break
      case 'link': node = <span title={token.href}>{children()} ({token.href})</span>; break
      case 'image': node = <span>{token.text} ({token.href})</span>; break
      case 'list': {
        const Tag = token.ordered ? 'ol' : 'ul'
        node = <Tag>{token.items.map((item: Token, i: number) => <li key={i}>{render([item], depth + 1)}</li>)}</Tag>; break
      }
      case 'list_item': node = <>{token.task ? (token.checked ? '☑ ' : '☐ ') : null}{children()}</>; break
      case 'table': node = <table><thead><tr>{token.header.map((cell: { tokens: Token[] }, i: number) => <th key={i}>{render(cell.tokens, depth + 1)}</th>)}</tr></thead><tbody>{token.rows.map((row: { tokens: Token[] }[], i: number) => <tr key={i}>{row.map((cell, j) => <td key={j}>{render(cell.tokens, depth + 1)}</td>)}</tr>)}</tbody></table>; break
      default: node = token.raw // Includes raw HTML: React escapes it.
    }
    return <Fragment key={index}>{node}</Fragment>
    })
  }
  return render(marked.lexer(text, { gfm: true }))
}

// Even the highlighter's generated HTML is converted to a tiny span/text tree.
// Unexpected tags are displayed as text, never parsed into privileged DOM.
export function renderPreviewHighlight(html: string): ReactNode {
  const stack: { className?: string; children: ReactNode[] }[] = [{ children: [] }]
  const parts = html.split(/(<[^>]*>)/g)
  if (parts.length > 8000) throw new Error('Highlight limit')
  const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_match, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" })[entity]!)
  for (const part of parts) {
    const match = /^<span class="(hljs-[\w-]+(?: [\w-]+)*)">$/.exec(part)
    if (match) {
      if (stack.length > 32) throw new Error('Highlight limit')
      stack.push({ className: match[1], children: [] })
    } else if (part === '</span>' && stack.length > 1) {
      const node = stack.pop()!
      const parent = stack[stack.length - 1]
      parent.children.push(<span key={parent.children.length} className={node.className}>{node.children}</span>)
    } else stack[stack.length - 1].children.push(decode(part))
  }
  if (stack.length !== 1) throw new Error('Invalid highlighting')
  return stack[0].children
}

function JsonNode({ name, value, depth = 0 }: { name?: string; value: unknown; depth?: number }) {
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
    return <details open={depth === 0} className="home-v2-rich-preview__json-node"><summary>{name ? `${name}: ` : ''}{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</summary>{entries.map(([key, child]) => <JsonNode key={key} name={key} value={child} depth={depth + 1} />)}</details>
  }
  return <div>{name !== undefined ? `${name}: ` : ''}{JSON.stringify(value)}</div>
}

export function RichPreviewBody({ kind, text }: { kind: RichPreviewKind; text: string }) {
  const formatted = useMemo(() => {
    if (kind === 'json') {
      const parsed = parsePreviewJson(text)
      if (parsed.ok) return <JsonNode value={parsed.value} />
    }
    if (kind === 'csv') {
      const { rows, truncated } = parsePreviewCsv(text)
      return <>{truncated ? <p role="status">{t('home2.richPreview.tableLimit')}</p> : null}<table><thead><tr>{rows[0]?.map((cell, i) => <th key={i} scope="col">{cell}</th>)}</tr></thead><tbody>{rows.slice(1).map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></>
    }
    if (kind === 'markdown') {
      try { return renderPreviewMarkdown(text) } catch { /* Large/complex Markdown remains readable as source. */ }
    }
    return null
  }, [kind, text])
  const [highlight, setHighlight] = useState<{ text: string; nodes: ReactNode } | null>(null)
  useEffect(() => {
    let canceled = false
    setHighlight(null)
    if (kind === 'code' && text.length <= 16 * 1024) {
      void import('highlight.js/lib/common').then(({ default: hljs }) => {
        // Bounded static transform, never evaluate publisher source.
        const result = hljs.highlightAuto(text, ['javascript', 'typescript', 'python', 'json', 'css', 'xml', 'bash', 'java', 'rust', 'sql'])
        const nodes = renderPreviewHighlight(result.value)
        if (!canceled) setHighlight({ text, nodes })
      }).catch(() => undefined)
    }
    return () => { canceled = true }
  }, [kind, text])
  if (formatted !== null) return formatted
  return <>{kind === 'json' || kind === 'markdown' ? <p role="status">{t('home2.richPreview.sourceFallback')}</p> : null}<pre><code>{kind === 'code' && highlight?.text === text ? highlight.nodes : text}</code></pre></>
}

export function HomeV2RichPreview({ kind, url, loadBytes }: {
  kind: RichPreviewKind
  url: string
  loadBytes: (url: string, maxBytes?: number) => Promise<{ bytes: Uint8Array }>
}) {
  const [state, setState] = useState<{ url: string; text?: string; error?: string } | null>(null)
  const [copyStatus, setCopyStatus] = useState('')
  useEffect(() => {
    let canceled = false
    setState(null); setCopyStatus('')
    void loadBytes(url, RICH_PREVIEW_MAX_BYTES).then(({ bytes }) => {
      if (bytes.byteLength > RICH_PREVIEW_MAX_BYTES) throw new Error('Preview exceeds 1 MiB.')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (!canceled) setState({ url, text })
    }).catch(() => { if (!canceled) setState({ url, error: t('home2.richPreview.unavailable') }) })
    return () => { canceled = true }
  }, [loadBytes, url])
  const current = state?.url === url ? state : null
  return <section className="home-v2-rich-preview" aria-label={kind} data-rich-preview={kind}>
    <div className="home-v2-rich-preview__toolbar"><span>{kind === 'text' ? t('docViewer.format.txt') : t(`viewer.type.${kind}`)}</span><button type="button" disabled={current?.text === undefined} onClick={() => {
      if (current?.text === undefined) return
      void Promise.resolve().then(() => navigator.clipboard.writeText(current.text!)).then(() => setCopyStatus(t('common.copied'))).catch(() => setCopyStatus(t('common.copyFailed')))
    }}>{t('viewer.copyText')}</button><span role="status">{copyStatus}</span></div>
    {kind === 'markdown' ? <p>{t('home2.richPreview.inertLinks')}</p> : null}
    {!current ? <p role="status">{t('viewer.preview.loading')}</p> : current.error ? <p role="alert">{current.error}</p> : <RichPreviewBody kind={kind} text={current.text!} />}
  </section>
}
