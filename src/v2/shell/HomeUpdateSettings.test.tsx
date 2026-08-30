import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { HomeV2AppUpdates } from '../../home-v2-live/app-update-controller'
import { HomeUpdateSettings } from './HomeUpdateSettings'

const rootElement = document.createElement('div')
document.body.append(rootElement)
const root = createRoot(rootElement)

function fixture(os: 'android' | 'linux', withDownload = false): HomeV2AppUpdates {
  return {
    available: true,
    busy: null,
  progress: null,
    channel: 'stable',
    check: async () => undefined,
    download: withDownload ? {
      canOpen: true,
      canReveal: os !== 'android',
      digestVerified: true,
      downloadId: os === 'android' ? 'android-native-download' : 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      fileName: os === 'android' ? 'Qortium-Home-android-release.apk' : 'Qortium-Home-x86_64.AppImage',
      releaseTag: 'v2.1.0',
      size: 123,
    } : null,
    downloadUpdate: async () => undefined,
    formattedSize: '123 bytes',
    homeUpdatePolicy: 'notify',
    isAndroid: os === 'android',
    message: null,
    openDownloaded: async () => undefined,
    openReleasePage: async () => undefined,
    revealDownloaded: async () => undefined,
    preferencesLoaded: true,
    result: {
      asset: { digestAvailable: true, name: os === 'android' ? 'Home.apk' : 'Home.AppImage', size: 123 },
      channel: 'stable',
      checkedAt: '2026-08-22T12:00:00.000Z',
      currentVersion: '2.0.0',
      issue: null,
      platform: { arch: 'x64', label: os === 'android' ? 'Android x64' : 'Linux x64', os, supported: true },
      release: { name: 'Home 2.1', publishedAt: null, tagName: 'v2.1.0' },
      revision: 1,
      schema: 'home-v2-app-update-check',
      state: 'available',
    },
    setChannel: () => undefined,
    canRevealInstallFolder: false,
  revealInstallFolder: async () => undefined,
  setHomeUpdatePolicy: () => undefined,
  } as HomeV2AppUpdates
}

await act(async () => { root.render(<HomeUpdateSettings updates={fixture('linux')} />) })
assert.equal(rootElement.querySelector('[data-home-v2-app-updates="desktop"]') !== null, true)
assert.equal((rootElement.querySelector('[data-home-v2-update-policy]') as HTMLSelectElement).value, 'notify')
assert.equal(
  rootElement.querySelector('[data-home-v2-update-policy]')?.getAttribute('aria-labelledby'),
  'home-update-policy-label',
)
assert.equal(rootElement.querySelector('[role="status"][aria-live="polite"]') !== null, true)
assert.deepEqual(
  [...rootElement.querySelectorAll('[data-home-v2-update-policy] option')].map((option) => option.textContent),
  ['Off', 'Notify only', 'Download automatically'],
)
assert.equal(rootElement.querySelector('[data-home-v2-update-action="download"]')?.textContent?.trim(), 'Download update')
assert.equal(rootElement.textContent?.includes('Show file'), false)

await act(async () => { root.render(<HomeUpdateSettings updates={fixture('linux', true)} />) })
assert.equal(rootElement.querySelector('[data-home-v2-update-action="open"]')?.textContent?.trim(), 'Open file')
assert.equal(rootElement.querySelector('[data-home-v2-update-action="reveal"]')?.textContent?.trim(), 'Show file')

await act(async () => { root.render(<HomeUpdateSettings updates={fixture('android', true)} />) })
assert.equal(rootElement.querySelector('[data-home-v2-app-updates="android"]') !== null, true)
assert.equal(
  (rootElement.querySelector('[data-home-v2-update-policy] option[value="auto-download"]') as HTMLOptionElement).disabled,
  true,
)
assert.equal(rootElement.querySelector('[data-home-v2-update-action="open"]')?.textContent?.trim(), 'Install APK')
assert.equal(rootElement.textContent?.includes('Start Core'), false)

// Home's own install folder can be opened, and the path never reaches here.
// 1.x showed it as a path row; #448 established that opening a folder needs no
// path in the renderer.
{
  let opened = 0
  await act(async () => {
    root.render(<HomeUpdateSettings updates={{
      ...fixture('linux'),
      canRevealInstallFolder: true,
      revealInstallFolder: async () => { opened += 1 },
    }} />)
  })
  const revealButton = rootElement.querySelector<HTMLButtonElement>(
    '[data-home-v2-update-action="reveal-install-folder"]',
  )
  assert(revealButton, 'expected an install-folder button when the host can open one')
  await act(async () => {
    revealButton.click()
    await Promise.resolve()
  })
  assert.equal(opened, 1)
  assert.doesNotMatch(rootElement.textContent ?? '', /\/(?:home|opt|usr|Users)\//)

  // A host that cannot open folders (Android) must not offer it.
  await act(async () => {
    root.render(<HomeUpdateSettings updates={{
      ...fixture('linux'), canRevealInstallFolder: false,
    }} />)
  })
  assert.equal(
    rootElement.querySelector('[data-home-v2-update-action="reveal-install-folder"]'),
    null,
  )
}

await act(async () => { root.unmount() })
console.log('Home 2 update settings tests passed.')
