import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { HomeV2ReleaseNotesPage } from './HomeV2ReleaseNotesPage'

const opened: string[] = []
window.homeV2ReleaseNotes = {
  load: async (product, tagName) => ({
    documentId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    product,
    releases: [{
      htmlUrl: `https://github.com/QortiumDev/${product === 'home' ? 'qortium-home' : 'qortium-core'}/releases/tag/${tagName}`,
      name: 'Home 2.1.0',
      publishedAt: '2026-08-23T00:00:00Z',
      tagName,
    }],
    revision: 1,
    schema: 'home-v2-release-notes-document',
    selected: {
      body: '# Changes\n- Read [the guide](https://docs.qortium.org)',
      htmlUrl: `https://github.com/QortiumDev/${product === 'home' ? 'qortium-home' : 'qortium-core'}/releases/tag/${tagName}`,
      name: 'Home 2.1.0',
      publishedAt: '2026-08-23T00:00:00Z',
      tagName,
    },
  }),
  openLink: async (_documentId, url) => {
    opened.push(url)
    return { revision: 1, schema: 'home-v2-release-notes-link-opened' }
  },
}

const element = document.createElement('div')
document.body.append(element)
const root = createRoot(element)
await act(async () => {
  root.render(<HomeV2ReleaseNotesPage
    target={{ product: 'home', tagName: 'v2.1.0' }}
    onNavigate={() => undefined}
  />)
  await Promise.resolve()
})
assert.match(element.textContent ?? '', /Qortium Home/)
assert.match(element.textContent ?? '', /v2\.1\.0/)
assert.match(element.textContent ?? '', /Changes/)
assert.match(element.textContent ?? '', /the guide/)
const guide = [...element.querySelectorAll('button')].find((button) => button.textContent === 'the guide')
await act(async () => { guide?.click(); await Promise.resolve() })
assert.deepEqual(opened, ['https://docs.qortium.org/'])
assert.equal(element.querySelector('select[aria-label="Product"]') !== null, true)
assert.equal(element.querySelector('select[aria-label="Version"]') !== null, true)

await act(async () => { root.unmount() })
element.remove()
console.log('Home 2 release notes page tests passed.')
