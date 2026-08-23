import assert from 'node:assert/strict'
import { extractAndroidHomeV2ReleaseNotesLinks } from './home-v2-android-release-notes'

const links = extractAndroidHomeV2ReleaseNotesLinks(
  'Read https://docs.qortium.org and https://docs.qortium.org/home.',
  'https://github.com/QortiumDev/qortium-home/releases/tag/v2.1.0',
)
assert.equal(links.has('https://docs.qortium.org/'), true)
assert.equal(links.has('https://docs.qortium.org/home'), true)
assert.equal(links.has('https://github.com/QortiumDev/qortium-home/releases/tag/v2.1.0'), true)
assert.equal(links.has('http://docs.qortium.org/'), false)

console.log('Android Home 2 release notes link tests passed.')
