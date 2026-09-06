import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { HomeV2RichPreview, RichPreviewBody, renderPreviewMarkdown, renderPreviewHighlight } from './HomeV2RichPreview'
import { parsePreviewCsv, parsePreviewJson, RICH_PREVIEW_MAX_BYTES } from './rich-preview'

assert.deepEqual(parsePreviewCsv('a,b\r\n"hello, world","line\r\nbreak"\r\n"a""b",end').rows,
  [['a', 'b'], ['hello, world', 'line\r\nbreak'], ['a"b', 'end']])
assert.deepEqual(parsePreviewCsv('"unfinished').rows, [['unfinished']])
assert.equal(parsePreviewCsv('a,b\n'.repeat(3000)).truncated, true)
assert.equal(parsePreviewCsv(','.repeat(101)).truncated, true)
assert.equal(parsePreviewCsv(('x,'.repeat(99) + 'x\n').repeat(110)).rows.flat().length, 10000)
assert.equal(parsePreviewJson('[0,false,null,{"ok":true}]').ok, true)
assert.equal(parsePreviewJson('{bad').ok, false)
assert.equal(parsePreviewJson('['.repeat(10000) + '0' + ']'.repeat(10000)).ok, false)
assert.equal(parsePreviewJson(JSON.stringify(Array(2001).fill(0))).ok, false)
const attack = '# Title\n\n<script>window.pwned=true</script>\n\n![beacon](https://beacon.example/a) [run](javascript:alert(1))\n\n<style>@import "https://beacon.example/s";</style>\n\n**bold**\n\n- list\n\n| A | B |\n| - | - |\n| one | two |'
const html = renderToStaticMarkup(<>{renderPreviewMarkdown(attack)}</>)
assert.match(html, /<h1>Title<\/h1>/)
assert.match(html, /<strong>bold<\/strong>/)
assert.match(html, /<table>/)
assert.doesNotMatch(html, /<(script|img|style|iframe|a|link)\b|\shref=|\ssrc=/)
assert.match(html, /&lt;script&gt;/)
assert.throws(() => renderPreviewMarkdown('x'.repeat(65537)), /limit/)
const highlighted = renderToStaticMarkup(<>{renderPreviewHighlight('<span class="hljs-string">&lt;img src=x onerror=bad&gt;</span><script>bad</script>')}</>)
assert.match(highlighted, /class="hljs-string"/)
assert.doesNotMatch(highlighted, /<(img|script)/)
assert.match(renderToStaticMarkup(<RichPreviewBody kind="json" text="{bad" />), /Showing source/)
assert.match(renderToStaticMarkup(<RichPreviewBody kind="json" text={'{"a":{"b":1}}'} />), /<details/)

const container = document.createElement('div')
document.body.append(container)
const root = createRoot(container)
const bytes = (text: string) => ({ bytes: new TextEncoder().encode(text) })
let finishOld!: (value: { bytes: Uint8Array }) => void
const loader = async (url: string, maxBytes?: number) => {
  assert.equal(maxBytes, RICH_PREVIEW_MAX_BYTES)
  if (url === 'old') return new Promise<{ bytes: Uint8Array }>(resolve => { finishOld = resolve })
  if (url === 'large') return { bytes: new Uint8Array(RICH_PREVIEW_MAX_BYTES + 1) }
  if (url === 'binary') return { bytes: new Uint8Array([255]) }
  if (url === 'failure') throw new Error('Internal capability details must not leak')
  return bytes('fresh text')
}
const show = async (url: string) => { await act(async () => { root.render(<HomeV2RichPreview kind="text" url={url} loadBytes={loader} />) }) }
await show('old')
assert.match(container.textContent!, /Loading/)
await show('fresh')
await act(async () => finishOld(bytes('stale text')))
assert.match(container.textContent!, /fresh text/)
assert.doesNotMatch(container.textContent!, /stale/)
let copied = ''
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied = text } } })
await act(async () => container.querySelector('button')!.click())
assert.equal(copied, 'fresh text')
assert.match(container.textContent!, /Copied/)
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
await act(async () => container.querySelector('button')!.click())
assert.match(container.textContent!, /Copy failed/)
for (const url of ['large', 'binary', 'failure']) {
  await show(url)
  assert.match(container.querySelector('[role="alert"]')!.textContent!, /Preview unavailable/)
  assert.equal(container.querySelector('button')!.disabled, true)
  assert.doesNotMatch(container.textContent!, /Internal capability/)
}
await show('old')
await act(async () => root.unmount())
await act(async () => finishOld(bytes('unmounted')))
console.log('Rich preview safe formatting, bounds, copy, decoding and lifecycle passed')
