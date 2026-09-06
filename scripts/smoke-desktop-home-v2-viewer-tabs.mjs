#!/usr/bin/env node
// Packaged shell + real native app, isolated profile/display and loopback-only
// public resources. No wallet, private attachment, live Core or publication.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { Cdp, launchHomeV2, resolveAppImage, sleep } from './lib/home-v2-cdp.mjs'

const root = path.resolve(import.meta.dirname, '..')
const profile = mkdtempSync(path.join(os.tmpdir(), 'home-viewer-tabs-'))
const log = text => console.log(`[viewer-tabs] ${text}`)
const imageAddress = 'qortal://IMAGE/ViewerArt/default'
const documentAddress = 'qortal://DOCUMENT/ViewerLibrary/default'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
function fixturePdf() {
  const content = 'BT /F1 18 Tf 40 150 Td (Public viewer fixture) Tj ET'
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>']
  let pdf = '%PDF-1.4\n', offsets = [0]
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  return Buffer.from(`${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
}
const pdf = fixturePdf()
const wav = Buffer.alloc(44 + 16000 * 20)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32)
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
const innerZip = new JSZip(); innerZip.file('manual.pdf', pdf)
const outerZip = new JSZip(); outerZip.file('inner.zip', await innerZip.generateAsync({ type: 'uint8array' }))
const archiveBytes = await outerZip.generateAsync({ type: 'nodebuffer' })
const epubZip = new JSZip()
epubZip.file('mimetype', 'application/epub+zip')
epubZip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
epubZip.file('book.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">position-fixture</dc:identifier><dc:title>Position fixture</dc:title><dc:language>en</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="one"/><itemref idref="two"/></spine></package>')
epubZip.file('toc.ncx', '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>Position fixture</text></docTitle><navMap><navPoint id="one" playOrder="1"><navLabel><text>First chapter</text></navLabel><content src="one.xhtml"/></navPoint><navPoint id="two" playOrder="2"><navLabel><text>Second chapter</text></navLabel><content src="two.xhtml"/></navPoint></navMap></ncx>')
for (const [name, label] of [['one', 'First'], ['two', 'Second']]) epubZip.file(`${name}.xhtml`, `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${label}</title></head><body><h1>${label} chapter fixture</h1><p>Position retention through fresh resource access.</p></body></html>`)
const epubBytes = await epubZip.generateAsync({ type: 'nodebuffer' })
let beaconReads = 0
let saveFailure = false, slowTextRead = false, textReads = 0
const richFixtures = {
  RichText: { filename: 'note.txt', mimeType: 'text/plain', text: 'Plain text <script>never executed</script>' + '\nViewer position fixture line'.repeat(250) },
  RichCode: { filename: 'example.js', mimeType: 'text/javascript', text: 'const value = "<img src=/beacon onerror=alert(1)>";' },
  RichJson: { filename: 'data.json', mimeType: 'application/json', text: '{"name":"Fixture","nested":{"ok":true}}' },
  RichCsv: { filename: 'data.csv', mimeType: 'text/csv', text: 'Name,Description\nFixture,"quoted, value"' },
  RichMarkdown: { filename: 'readme.md', mimeType: 'text/markdown', text: '# Rich preview\n\n**Formatted safely**\n\n![beacon](/beacon) [link](/beacon)\n\n<img src="/beacon"><script>window.richPreviewExecuted=true</script>' },
  RichLarge: { filename: 'large.txt', mimeType: 'text/plain', text: 'x'.repeat(1024 * 1024 + 1) },
}
const fixture = createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture')
  if (url.pathname === '/beacon') { beaconReads++; response.end('blocked fixture'); return }
  const rich = Object.entries(richFixtures).find(([name]) => url.pathname.includes(`/${name}/`))?.[1]
  if (url.pathname.startsWith('/render/')) {
    if (rich === richFixtures.RichText) {
      textReads++
      if (saveFailure) {
        saveFailure = false
        setTimeout(() => { response.writeHead(500); response.end('Fixture save failure') }, 1000)
        return
      }
      if (slowTextRead) {
        setTimeout(() => { response.setHeader('Content-Type', rich.mimeType); response.end(rich.text) }, 1000)
        return
      }
    }
    if (rich) { response.setHeader('Content-Type', rich.mimeType); response.end(rich.text) }
    else if (url.pathname.includes('/ViewerEpub/')) { response.setHeader('Content-Type', 'application/epub+zip'); response.end(epubBytes) }
    else if (url.pathname.includes('/ViewerArchive/')) { response.setHeader('Content-Type', 'application/zip'); response.end(archiveBytes) }
    else if (url.pathname.includes('/AUDIO/')) { response.setHeader('Content-Type', 'audio/wav'); response.end(wav) }
    else if (url.pathname.includes('/IMAGE/')) { response.setHeader('Content-Type', 'image/png'); response.end(png) }
    else if (url.pathname.includes('/DOCUMENT/')) { response.setHeader('Content-Type', 'application/pdf'); response.end(pdf) }
    else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><body><h1>Public viewer source app</h1></body></html>') }
    return
  }
  response.setHeader('Content-Type', 'application/json')
  let value = []
  if (url.pathname === '/admin/status') value = { height: 1, isSynchronizing: false, numberOfConnections: 1 }
  else if (url.pathname === '/admin/info') value = { buildVersion: 'smoke', currentTimestamp: Date.now() }
  else if (url.pathname.includes('/resource/status/')) value = { status: 'READY', localChunkCount: 1, totalChunkCount: 1 }
  else if (url.pathname.includes('/resource/properties/')) value = url.pathname.includes('/ViewerEpub/')
    ? { filename: 'book.epub', mimeType: 'application/epub+zip', size: epubBytes.length }
    : url.pathname.includes('/ViewerArchive/')
    ? { filename: 'nested.zip', mimeType: 'application/zip', size: archiveBytes.length }
    : url.pathname.includes('/AUDIO/') ? { filename: 'silence.wav', mimeType: 'audio/wav', size: wav.length }
    : rich ? { filename: rich.filename, mimeType: rich.mimeType, size: Buffer.byteLength(rich.text) } : url.pathname.includes('/DOCUMENT/')
    ? { filename: 'manual.pdf', mimeType: 'application/pdf', size: pdf.length }
    : { filename: 'art.png', mimeType: 'image/png', size: png.length }
  else if (url.pathname.startsWith('/names/')) value = { name: url.pathname.split('/').at(-1), owner: 'QFixture' }
  response.end(JSON.stringify(value))
})
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${fixture.address().port}`
writeFileSync(path.join(profile, 'node-settings.json'), JSON.stringify({ mode: 'disabled', customUrl: '', apiKey: '' }))
writeFileSync(path.join(profile, 'qortal-node-settings.json'), JSON.stringify({ mode: 'custom', customUrl: origin, lastEnabledMode: 'custom' }))
const stateFile = path.join(profile, 'home-v2-shell-state.json')
writeFileSync(stateFile, JSON.stringify({ version: 4,
  onboarding: { version: 1, status: 'skipped', currentStep: 'finish' },
  product: { activeTabId: 'dashboard', entries: [{ kind: 'internal', id: 'dashboard', page: 'dashboard' }] } }))
Object.assign(process.env, { XDG_CONFIG_HOME: path.join(profile, 'xdg'), QORTIUM_HOME_NODE_API_URL: origin,
  QORTIUM_HOME_QORTAL_NODE_API_URL: origin, XDG_SESSION_TYPE: 'x11', ELECTRON_OZONE_PLATFORM_HINT: 'x11' })
delete process.env.DISPLAY
delete process.env.WAYLAND_DISPLAY
delete process.env.ELECTRON_RUN_AS_NODE
let home, xServer, wm, app
async function until(label, test) {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) { if (await test()) return; await sleep(150) }
  if (home?.cdp) {
    const snapshot = await home.cdp.send('Page.captureScreenshot').catch(() => null)
    if (snapshot) writeFileSync(path.join(profile, 'failure.png'), Buffer.from(snapshot.data, 'base64'))
    writeFileSync(path.join(profile, 'failure-state.txt'), await home.cdp.evaluate(`document.body.innerText`).catch(String))
    const windows = spawnSync('xwininfo', ['-root', '-tree'], { encoding: 'utf8', env: process.env })
    writeFileSync(path.join(profile, 'failure-windows.txt'), windows.stdout || windows.stderr || '')
    log(`failure evidence ${profile}`)
  }
  throw new Error(`Timed out: ${label}`)
}
try {
  xServer = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1200x900x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] })
  const display = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('Private display timeout')), 10000)
    xServer.once('error', reject)
    xServer.stdio[3].on('data', data => {
      output += data.toString()
      if (/^\d+\n$/.test(output)) { clearTimeout(timer); resolve(`:${output.trim()}`) }
    })
  })
  process.env.DISPLAY = display
  wm = spawn('openbox', [], { stdio: 'ignore', env: { ...process.env } })
  await sleep(800)
  // Electron 39: keep native file choosers on our private X display rather than
  // delegating to a portal on the developer's inherited desktop session bus.
  const start = () => launchHomeV2({ appImage: resolveAppImage(root), profile, portBase: 11300, log,
    appArgs: ['--ozone-platform=x11', '--xdg-portal-required-version=999'] })
  home = await start()
  let cdp = home.cdp
  const click = async selector => { const point = await cdp.box(selector); assert.ok(point, selector); await cdp.click(point.x, point.y) }
  const current = () => cdp.evaluate(`document.querySelector('.home-v2-tab [aria-selected="true"]').closest('.home-v2-tab').dataset.tabId`)
  const imageReady = () => cdp.evaluate(`!!document.querySelector('[data-viewer-tab] img')?.naturalWidth`)
  async function open(address) {
    await click('.home-v2-address input')
    await cdp.evaluate(`document.querySelector('.home-v2-address input').select()`)
    await cdp.send('Input.insertText', { text: address })
    await click('.home-v2-address button[type="submit"]')
  }
  await open('qortal://APP/ViewerSource/published')
  let target
  await until('native source app', async () => {
    target = (await (await fetch(`http://127.0.0.1:${home.port}/json/list`)).json()).find(value => value.url.includes('/render/APP/ViewerSource/'))
    return !!target
  })
  app = new Cdp(target.webSocketDebuggerUrl)
  await app.ready
  const sourceId = await current()
  await until('source bridge and visible native view', () => app.evaluate(`typeof window.qortalRequest === 'function' && document.visibilityState === 'visible'`))
  assert.equal(await app.evaluate(`window.qortalRequest({ action:'OPEN_QDN_RESOURCE_VIEWER', service:'IMAGE', name:'ViewerArt', identifier:'default' })`), true)
  await until('public image tab', imageReady)
  const firstId = await current()
  assert.notEqual(firstId, sourceId)
  await until('source native view hidden beneath viewer', () => app.evaluate(`document.visibilityState === 'hidden'`))
  await click(`.home-v2-tab[data-tab-id="${sourceId}"] button[role="tab"]`)
  await until('source native view restored', () => app.evaluate(`document.visibilityState === 'visible'`))
  await click(`.home-v2-tab[data-tab-id="${firstId}"] button[role="tab"]`)
  await until('viewer fresh access after switching', imageReady)
  await click(`.home-v2-tab[data-tab-id="${sourceId}"] .home-v2-tab__close`)
  await until('source closed, public viewer survives', () => cdp.evaluate(`!document.querySelector('.home-v2-tab[data-tab-id="${sourceId}"]') && !!document.querySelector('[data-viewer-tab] img')?.naturalWidth`))
  await click('.home-v2-bookmarks-button')
  await click('.home-v2-bookmarks-menu__panel button[role="menuitem"]')
  await until('viewer bookmarked with explicit guest attribution', () => cdp.evaluate(`JSON.parse(localStorage.getItem('qortium-home-bookmark-manager-snapshot')).bookmarks.some(link => link.displayUrl === ${JSON.stringify(imageAddress)} && link.accountId === 'home-v2:guest')`))
  await open(imageAddress)
  await until('independent same-resource instance', async () => await current() !== firstId && await imageReady())
  await open(documentAddress)
  await until('retained PDF in nonmodal tab', () => cdp.evaluate(`document.querySelector('[data-viewer-tab] .doc-viewer-dialog')?.getAttribute('role') === 'region' && !!document.querySelector('[data-viewer-tab] canvas')`))
  const screenshot = await cdp.send('Page.captureScreenshot')
  writeFileSync(path.join(profile, 'viewer-tabs.png'), Buffer.from(screenshot.data, 'base64'))
  const docId = await current()
  await click(`.home-v2-tab[data-tab-id="${docId}"] .home-v2-tab__close`)
  await click('.home-v2-address input')
  const xdo = args => { const result = spawnSync('xdotool', args, { encoding: 'utf8', env: process.env }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim() }
  const windows = xdo(['search', '--onlyvisible', '--class', '.']).split('\n')
  const owner = windows.find(id => { const size = /Geometry:\s*(\d+)x(\d+)/.exec(xdo(['getwindowgeometry', id])); return size && +size[1] > 400 && +size[2] > 300 })
  assert.ok(owner)
  xdo(['windowactivate', '--sync', owner]); xdo(['key', '--clearmodifiers', 'ctrl+shift+t'])
  await until('reopened PDF uses fresh tab identity', async () => await current() !== docId && await cdp.evaluate(`!!document.querySelector('[data-viewer-tab] canvas')`))
  await until('coordinate-only state saved', () => {
    const saved = JSON.parse(readFileSync(stateFile, 'utf8'))
    return saved.product.entries.filter(entry => entry.kind === 'viewer').length === 3
  })
  const saved = JSON.parse(readFileSync(stateFile, 'utf8'))
  assert.equal(saved.product.entries.some(entry => entry.kind === 'app'), false)
  assert.equal(/streamUrl|qdnHomeStream|walletRef|nodeApiUrl/.test(JSON.stringify(saved.product.entries)), false)
  log('native app/source-close, independent image/PDF, bookmark and Ctrl+Shift+T passed')
  home.cdp.socket.close(); home.shutdown(); home = null
  await sleep(2500)
  home = await start(); cdp = home.cdp
  await until('PDF restored after full process restart', () => cdp.evaluate(`!!document.querySelector('[data-viewer-tab] canvas')`))
  assert.equal(await cdp.evaluate(`document.querySelector('.home-v2-address input').value`), documentAddress)
  assert.equal(await cdp.evaluate(`document.querySelectorAll('.home-v2-tabs button[role="tab"]').length`), 4)
  // Seed only the disposable collection to exercise migrated start-page routing.
  await cdp.evaluate(`(() => { const key='qortium-home-bookmark-manager-snapshot'; const saved=JSON.parse(localStorage.getItem(key));
    saved.startPages=[{title:'Public art',displayUrl:${JSON.stringify(imageAddress)},accountId:'home-v2:guest'}];
    saved.revision++; localStorage.setItem(key,JSON.stringify(saved)); })()`)
  // This fixture mutates localStorage directly. Let Chromium flush it through
  // normal Quit before testing the startup policy, rather than SIGTERM the
  // storage process immediately after its acknowledgement. The earlier restart
  // above still exercises the abrupt-shutdown session-restore path.
  await click('.home-v2-address input')
  xdo(['key', '--clearmodifiers', 'ctrl+q'])
  await until('clean fixture shutdown', () => fetch(`http://127.0.0.1:${home.port}/json/list`).then(() => false, () => true))
  home.cdp.socket.close(); home.shutdown(); home = null
  await sleep(2500)
  const startup = JSON.parse(readFileSync(stateFile, 'utf8'))
  startup.startupPreference = { kind: 'startPages' }
  writeFileSync(stateFile, JSON.stringify(startup))
  home = await start(); cdp = home.cdp
  await until('saved viewer start page opens', imageReady)
  assert.equal(await cdp.evaluate(`document.querySelector('.home-v2-address input').value`), imageAddress)
  log(`full process restore and saved viewer start page passed; evidence ${profile}`)
  for (const [name, kind, selector] of [
    // Auto-detection may identify the embedded hostile markup as XML; assert
    // highlighting without requiring a particular grammar's keyword token.
    ['RichText', 'text', 'pre'], ['RichCode', 'code', '.hljs-string'],
    ['RichJson', 'json', 'details'], ['RichCsv', 'csv', 'table td'],
    ['RichMarkdown', 'markdown', 'h1'], ['RichLarge', 'text', '[role="alert"]'],
  ]) {
    await open(`qortal://FILE/${name}/default`)
    await until(`${kind} ${name} rendered`, () => cdp.evaluate(`!!document.querySelector('[data-rich-preview="${kind}"] ${selector}')`))
    assert.equal(await cdp.evaluate(`!!document.querySelector('[data-rich-preview] script, [data-rich-preview] img, [data-rich-preview] iframe, [data-rich-preview] a[href]')`), false)
    assert.equal(await cdp.evaluate(`window.richPreviewExecuted === true`), false)
    assert.equal(await cdp.evaluate(`!!document.querySelector('.home-v2-resource-viewer__open')`), true)
    if (name === 'RichMarkdown') {
      assert.equal(await cdp.evaluate(`document.querySelector('[data-rich-preview] strong').textContent`), 'Formatted safely')
      const shot = await cdp.send('Page.captureScreenshot')
      writeFileSync(path.join(profile, 'rich-markdown.png'), Buffer.from(shot.data, 'base64'))
    }
    if (name === 'RichLarge') assert.match(await cdp.evaluate(`document.querySelector('[data-rich-preview] [role="alert"]').textContent`), /1 MiB/)
  }
  assert.equal(beaconReads, 0)
  log('text/code/JSON/CSV/Markdown, inert publisher HTML/links/images and producer 1 MiB refusal passed')
  await open('qortal://FILE/RichText/default')
  await until('text ready for save', () => cdp.evaluate(`!!document.querySelector('[data-rich-preview="text"] pre')`))
  const savePhase = expected => cdp.evaluate(`document.querySelector('[data-save-phase]')?.dataset.savePhase === ${JSON.stringify(expected)}`)
  const saveClick = () => click('.home-v2-resource-viewer__open')
  const nativeSaveDialog = () => {
    const found = spawnSync('xdotool', ['search', '--onlyvisible', '--name', 'Save'], { encoding: 'utf8', env: process.env })
    return found.status === 0 && !!found.stdout.trim()
  }
  saveFailure = true
  const beforeFailure = textReads
  await saveClick()
  await until('visible saving feedback', () => savePhase('saving'))
  assert.equal(await cdp.evaluate(`document.querySelector('.home-v2-resource-viewer__open').disabled`), true)
  await cdp.evaluate(`document.querySelector('.home-v2-resource-viewer__open').click()`)
  await until('visible failed save', () => savePhase('error'))
  assert.equal(textReads, beforeFailure + 1, 'No duplicate resource read while saving')
  assert.equal(await cdp.evaluate(`document.querySelector('.home-v2-resource-viewer__open').disabled`), false)
  const failedShot = await cdp.send('Page.captureScreenshot')
  writeFileSync(path.join(profile, 'save-error.png'), Buffer.from(failedShot.data, 'base64'))
  slowTextRead = true
  await saveClick()
  await until('real native save dialog for retry', nativeSaveDialog)
  xdo(['key', '--clearmodifiers', 'Escape'])
  await until('native cancellation is not failure or success', () => savePhase('canceled'))
  await saveClick()
  await until('real native save dialog for success', nativeSaveDialog)
  const savedFile = path.join(profile, 'saved-note.txt')
  xdo(['key', '--clearmodifiers', 'ctrl+l'])
  // GTK may preselect only the basename, leaving its extension in the field.
  xdo(['key', '--clearmodifiers', 'ctrl+a'])
  xdo(['type', '--clearmodifiers', '--delay', '1', savedFile])
  xdo(['key', '--clearmodifiers', 'Return'])
  await until('save completed and file written', async () => existsSync(savedFile) && await savePhase('saved'))
  assert.equal(readFileSync(savedFile, 'utf8'), richFixtures.RichText.text)
  await open(documentAddress)
  await until('PDF ready for save', () => cdp.evaluate(`!!document.querySelector('[data-viewer-tab] canvas')`))
  await click('button[aria-label="Download"]')
  await until('document native save dialog', nativeSaveDialog)
  xdo(['key', '--clearmodifiers', 'Escape'])
  await until('document cancellation feedback', () => savePhase('canceled'))
  log('save busy/single-flight/error/retry, real native cancel/write and document feedback passed')
  const switchTo = async id => {
    const selector = `.home-v2-tab[data-tab-id="${id}"] button[role="tab"]`
    await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`)
    await click(selector)
  }
  const positionDocId = await current()
  await click('button[aria-label="Next page"]')
  await click('button[aria-label="Zoom in"]')
  await until('PDF page/zoom changed', () => cdp.evaluate(`document.querySelector('.doc-viewer__page-indicator')?.textContent === '2 / 2' && document.querySelector('.doc-viewer__zoom-level')?.textContent.includes('125')`))
  await open('qortal://FILE/RichText/default')
  await until('long text loaded', () => cdp.evaluate(`!!document.querySelector('[data-rich-preview="text"] pre')`))
  const positionTextId = await current()
  await cdp.evaluate(`document.querySelector('.home-v2-resource-viewer__content').scrollTop = 700`)
  await until('text scrolled', () => cdp.evaluate(`document.querySelector('.home-v2-resource-viewer__content').scrollTop === 700`))
  await open('qortal://AUDIO/ViewerAudio/default')
  await until('native audio metadata', () => cdp.evaluate(`document.querySelector('audio')?.duration === 20`))
  const positionAudioId = await current()
  await cdp.evaluate(`document.querySelector('audio').currentTime = 5.5`)
  await until('native audio seek', () => cdp.evaluate(`Math.abs(document.querySelector('audio').currentTime - 5.5) < .1`))
  await switchTo(positionDocId)
  await until('PDF page/zoom retained across fresh access', () => cdp.evaluate(`document.querySelector('.doc-viewer__page-indicator')?.textContent === '2 / 2' && document.querySelector('.doc-viewer__zoom-level')?.textContent.includes('125')`))
  const positionShot = await cdp.send('Page.captureScreenshot')
  writeFileSync(path.join(profile, 'viewer-position.png'), Buffer.from(positionShot.data, 'base64'))
  const beforeReturn = textReads
  await switchTo(positionTextId)
  await until('text scroll restored after fresh read', () => cdp.evaluate(`document.querySelector('.home-v2-resource-viewer__content')?.scrollTop === 700`))
  assert.ok(textReads > beforeReturn, 'Returning still reacquires/reads the public resource')
  const beforeReload = textReads
  await click('button[aria-label="Reload"]')
  await until('same-resource refresh retains scroll', async () => textReads > beforeReload && await cdp.evaluate(`document.querySelector('.home-v2-resource-viewer__content')?.scrollTop === 700`))
  await switchTo(positionDocId)
  await until('unrelated reload does not clear background PDF', () => cdp.evaluate(`document.querySelector('.doc-viewer__page-indicator')?.textContent === '2 / 2' && document.querySelector('.doc-viewer__zoom-level')?.textContent.includes('125')`))
  await switchTo(positionAudioId)
  await until('audio time restored without playback', () => cdp.evaluate(`document.querySelector('audio')?.paused && Math.abs(document.querySelector('audio').currentTime - 5.5) < .1`))
  await open('qortal://FILE/ViewerArchive/default')
  const positionArchiveId = await current()
  await until('outer archive loaded', () => cdp.evaluate(`!!document.querySelector('.qdn-archive__open')`))
  await click('.qdn-archive__open')
  await until('inner archive loaded', () => cdp.evaluate(`document.querySelector('.qdn-archive__open')?.textContent.includes('manual.pdf')`))
  await click('.qdn-archive__open')
  await until('nested PDF loaded', () => cdp.evaluate(`!!document.querySelector('.doc-viewer__page-indicator')`))
  await click('button[aria-label="Next page"]')
  await switchTo(positionTextId)
  await until('text survives archive switch', () => cdp.evaluate(`document.querySelector('.home-v2-resource-viewer__content')?.scrollTop === 700`))
  await switchTo(positionArchiveId)
  await until('nested archive document/page restored', () => cdp.evaluate(`document.querySelector('.doc-viewer__page-indicator')?.textContent === '2 / 2'`))
  await open('qortal://DOCUMENT/ViewerEpub/default')
  const positionEpubId = await current()
  const epubChapterVisible = label => cdp.evaluate(`[...document.querySelectorAll('.doc-viewer__epub-frame iframe')].some(frame => frame.contentDocument?.body?.textContent.includes(${JSON.stringify(label)}))`)
  await until('EPUB first display', () => epubChapterVisible('First chapter fixture'))
  await click('button[aria-label="Table of contents"]')
  await click('.doc-viewer__toc-panel li:nth-child(2) button')
  await until('EPUB second chapter', () => epubChapterVisible('Second chapter fixture'))
  await switchTo(positionTextId)
  await until('text ready while EPUB inactive', () => cdp.evaluate(`!!document.querySelector('[data-rich-preview="text"] pre')`))
  await switchTo(positionEpubId)
  await until('EPUB location restored on first display', () => epubChapterVisible('Second chapter fixture'))
  const closeEpub = `.home-v2-tab[data-tab-id="${positionEpubId}"] .home-v2-tab__close`
  // Many fixture tabs overflow the strip: showing the tab label does not
  // guarantee its separate close button is within the viewport.
  await cdp.evaluate(`document.querySelector(${JSON.stringify(closeEpub)}).scrollIntoView({block:'nearest',inline:'nearest'})`)
  await click(closeEpub)
  await until('EPUB tab actually closed', () => cdp.evaluate(`!document.querySelector(${JSON.stringify(closeEpub)})`))
  await click('.home-v2-address input')
  xdo(['key', '--clearmodifiers', 'ctrl+shift+t'])
  await until('closed-tab reopening starts a new reading position', () => epubChapterVisible('First chapter fixture'))
  assert.notEqual(await current(), positionEpubId)
  assert.equal(/epubCfi|mediaTime|archivePath/.test(readFileSync(stateFile, 'utf8')), false, 'Positions are not persisted in session state')
  log('per-tab PDF page/zoom, EPUB location, asynchronous text scroll, paused native media and nested archive position passed')
} finally {
  app?.socket.close(); home?.cdp.socket.close(); home?.shutdown()
  wm?.kill(); xServer?.kill(); fixture.closeAllConnections(); fixture.close()
}
