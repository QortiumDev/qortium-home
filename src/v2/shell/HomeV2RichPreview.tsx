import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { ViewerPosition } from '../../viewer-position'
import { useViewerScroll } from '../../use-viewer-scroll'
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

// The plain source view renders ONE element per source line, tagged with its
// 1-based number, so an address that asks to open at a line is answered by
// measuring that element instead of guessing a proportion of the content
// height. The spans are inline and carry their own newline, so the laid-out
// text, selection and copying are byte-identical to a single text node.
export const PREVIEW_SOURCE_LINE_ATTRIBUTE = 'data-source-line'
// A guard for pathological single-line-per-byte files: past this the preview
// stays one text node and `line` simply finds no element to measure.
const PREVIEW_MAX_SOURCE_LINE_ELEMENTS = 20_000

export function renderPreviewSourceLines(text: string): ReactNode {
  const lines = text.split('\n')
  if (lines.length > PREVIEW_MAX_SOURCE_LINE_ELEMENTS) return text
  return lines.map((line, index) =>
    <span key={index} data-source-line={index + 1}>{index === lines.length - 1 ? line : `${line}\n`}</span>)
}

/**
 * Scroll offset of a laid-out element inside its scrolling ancestor, measured
 * through the offsetParent chain, so wrapping, formatting and the preview's own
 * toolbar are all accounted for rather than assumed away.
 */
export function offsetTopWithin(target: HTMLElement, container: HTMLElement): number {
  let top = 0
  let node: HTMLElement | null = target
  while (node && node !== container) {
    top += node.offsetTop
    const parent: Element | null = node.offsetParent
    // An unpositioned container is not an offsetParent, so the chain steps
    // straight past it to a shared ancestor: the container's own offset in that
    // ancestor is then exactly what separates the two.
    if (!(parent instanceof HTMLElement) || parent === container || !container.contains(parent)) {
      return Math.max(0, parent === container ? top : top - container.offsetTop)
    }
    node = parent
  }
  return Math.max(0, top)
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
  return <>{kind === 'json' || kind === 'markdown' ? <p role="status">{t('home2.richPreview.sourceFallback')}</p> : null}<pre><code>{kind === 'code' && highlight?.text === text ? highlight.nodes : renderPreviewSourceLines(text)}</code></pre></>
}

export function HomeV2RichPreview({ kind, url, loadBytes, position, scrollRef }: {
  position?: ViewerPosition
  scrollRef?: RefObject<HTMLElement | null>
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
  const unusedRef = useRef<HTMLElement>(null)
  // An address may ask to open at a line. It becomes an ordinary scroll target
  // only where the preview laid out an element for that source line, MEASURED
  // against the scroll container: a formatted preview (Markdown, parsed JSON,
  // CSV cells) has no such element and simply ignores the key. Either way the
  // request is consumed in this same pass, so it applies once and the reader's
  // own scrolling wins from then on. Runs before useViewerScroll below, which
  // reads position.scroll.
  useLayoutEffect(() => {
    const element = scrollRef?.current
    if (!position || position.line === undefined || current?.text === undefined || !element) return
    const line = position.line
    position.line = undefined
    // `line` is a validated positive integer, so the selector needs no escaping.
    const target = Number.isSafeInteger(line) && line > 0
      ? element.querySelector<HTMLElement>(`[${PREVIEW_SOURCE_LINE_ATTRIBUTE}="${line}"]`) : null
    if (target) position.scroll = { top: offsetTopWithin(target, element), left: 0 }
  }, [current?.text, position, scrollRef])
  useViewerScroll(scrollRef ?? unusedRef, position, current?.text !== undefined)
  return <section className="home-v2-rich-preview" aria-label={kind} data-rich-preview={kind}>
    <div className="home-v2-rich-preview__toolbar"><span>{kind === 'text' ? t('docViewer.format.txt') : t(`viewer.type.${kind}`)}</span><button type="button" disabled={current?.text === undefined} onClick={() => {
      if (current?.text === undefined) return
      void Promise.resolve().then(() => navigator.clipboard.writeText(current.text!)).then(() => setCopyStatus(t('common.copied'))).catch(() => setCopyStatus(t('common.copyFailed')))
    }}>{t('viewer.copyText')}</button><span role="status">{copyStatus}</span></div>
    {kind === 'markdown' ? <p>{t('home2.richPreview.inertLinks')}</p> : null}
    {!current ? <p role="status">{t('viewer.preview.loading')}</p> : current.error ? <p role="alert">{current.error}</p> : <RichPreviewBody kind={kind} text={current.text!} />}
  </section>
}
