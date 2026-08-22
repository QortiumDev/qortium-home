import assert from 'node:assert/strict'
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { AndroidHomeV2UpdateHost } from '../home-v2-android-app-updates'
import type { HomeV2AppUpdateSettings } from './app-update-client'
import { serializeHomeV2AppUpdatePreferences } from './app-update-preferences'
import { useHomeV2AppUpdates, type HomeV2AppUpdates } from './app-update-controller'

const available = {
  asset: { digestAvailable: true, name: 'Qortium-Home-2.1.0-x86_64.AppImage', size: 123 },
  channel: 'prerelease',
  checkedAt: '2026-08-22T12:00:00.000Z',
  currentVersion: '2.0.0',
  issue: null,
  platform: { arch: 'x64', label: 'Linux x64', os: 'linux', supported: true },
  release: { name: 'Home 2.1', publishedAt: null, tagName: 'v2.1.0' },
  revision: 1,
  schema: 'home-v2-app-update-check',
  state: 'available',
} as const

function Harness({
  nativeHost = null,
  onState,
}: {
  readonly nativeHost?: AndroidHomeV2UpdateHost | null
  readonly onState: (state: HomeV2AppUpdates) => void
}) {
  const state = useHomeV2AppUpdates(nativeHost)
  useEffect(() => onState(state), [onState, state])
  return null
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
  throw new Error('Timed out waiting for Home 2 update controller state.')
}

async function runScenario({
  policy,
  expectedChecks,
  expectedDownloads,
}: {
  readonly expectedChecks: number
  readonly expectedDownloads: number
  readonly policy: 'auto-download' | 'notify' | 'off'
}) {
  let checks = 0
  let downloads = 0
  let hostSettings: HomeV2AppUpdateSettings = {
    generation: 7,
    homeUpdatePolicy: policy,
    releaseChannel: 'prerelease',
    revision: 1 as const,
    schema: 'home-v2-app-update-settings' as const,
  }
  const automaticClaims = new Set<number>()
  window.homeV2AppUpdates = {
    check: async (channel, settingsGeneration) => {
      checks += 1
      assert.equal(channel, 'prerelease')
      assert.equal(settingsGeneration, 7)
      return available
    },
    claimAutomatic: async () => {
      const claimed = policy !== 'off' && !automaticClaims.has(hostSettings.generation)
      if (claimed) automaticClaims.add(hostSettings.generation)
      return {
        ...hostSettings,
        claimed,
        schema: 'home-v2-app-update-automatic-claim' as const,
      }
    },
    download: async (channel, releaseTag, settingsGeneration) => {
      downloads += 1
      assert.equal(channel, 'prerelease')
      assert.equal(releaseTag, 'v2.1.0')
      assert.equal(settingsGeneration, policy === 'auto-download' ? 7 : null)
      return {
        code: null,
        download: {
          canOpen: true,
          canReveal: true,
          digestVerified: true,
          downloadId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          fileName: available.asset.name,
          releaseTag,
          size: available.asset.size,
        },
        outcome: 'completed',
        revision: 1,
        schema: 'home-v2-app-update-action',
      }
    },
    getSettings: async () => hostSettings,
    openReleasePage: async () => ({ code: null, download: null, outcome: 'completed', revision: 1, schema: 'home-v2-app-update-action' }),
    reveal: async () => ({ code: null, download: null, outcome: 'completed', revision: 1, schema: 'home-v2-app-update-action' }),
    setSettings: async (expectedGeneration, settings) => {
      assert.equal(expectedGeneration, hostSettings.generation)
      hostSettings = { ...hostSettings, ...settings, generation: hostSettings.generation + 1 }
      return hostSettings
    },
  }
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  let latest: HomeV2AppUpdates | null = null
  await act(async () => { root.render(<Harness onState={(state) => { latest = state }} />) })
  await waitFor(() => {
    const state = latest as HomeV2AppUpdates | null
    return !!state?.preferencesLoaded && state.busy === null &&
      checks === expectedChecks && downloads === expectedDownloads
  })
  assert.equal((latest as HomeV2AppUpdates | null)?.channel, 'prerelease')
  assert.equal((latest as HomeV2AppUpdates | null)?.homeUpdatePolicy, policy)
  assert.equal(checks, expectedChecks)
  assert.equal(downloads, expectedDownloads)
  if (policy === 'auto-download') {
    assert.equal((latest as HomeV2AppUpdates | null)?.download?.digestVerified, true)
  }
  if (policy === 'notify') {
    await act(async () => {
      ;(latest as HomeV2AppUpdates).setChannel('stable')
      ;(latest as HomeV2AppUpdates).setHomeUpdatePolicy('off')
    })
    await waitFor(() => hostSettings.generation === 9)
    assert.equal(hostSettings.releaseChannel, 'stable')
    assert.equal(hostSettings.homeUpdatePolicy, 'off')
    assert.equal((latest as HomeV2AppUpdates | null)?.channel, 'stable')
    assert.equal((latest as HomeV2AppUpdates | null)?.homeUpdatePolicy, 'off')
  }
  await act(async () => { root.unmount() })
  element.remove()
}

await runScenario({ policy: 'off', expectedChecks: 0, expectedDownloads: 0 })
await runScenario({ policy: 'notify', expectedChecks: 1, expectedDownloads: 0 })
await runScenario({ policy: 'auto-download', expectedChecks: 1, expectedDownloads: 1 })

let conflictSettings: HomeV2AppUpdateSettings = {
  generation: 5,
  homeUpdatePolicy: 'off',
  releaseChannel: 'stable',
  revision: 1,
  schema: 'home-v2-app-update-settings',
}
let conflictWrites = 0
window.homeV2AppUpdates = {
  check: async () => { throw new Error('Off must not check automatically.') },
  claimAutomatic: async () => ({
    ...conflictSettings,
    claimed: false,
    schema: 'home-v2-app-update-automatic-claim' as const,
  }),
  download: async () => { throw new Error('Off must not download automatically.') },
  getSettings: async () => conflictSettings,
  openReleasePage: async () => ({ code: null, download: null, outcome: 'completed', revision: 1, schema: 'home-v2-app-update-action' }),
  reveal: async () => ({ code: null, download: null, outcome: 'completed', revision: 1, schema: 'home-v2-app-update-action' }),
  setSettings: async (expectedGeneration, settings) => {
    conflictWrites += 1
    if (conflictWrites === 1) {
      assert.equal(expectedGeneration, 5)
      conflictSettings = { ...conflictSettings, generation: 6, releaseChannel: 'prerelease' }
      throw new Error('App update settings changed in another Home window.')
    }
    assert.equal(expectedGeneration, 6)
    conflictSettings = { ...conflictSettings, ...settings, generation: 7 }
    return conflictSettings
  },
}
const conflictElement = document.createElement('div')
document.body.append(conflictElement)
const conflictRoot = createRoot(conflictElement)
let conflictState: HomeV2AppUpdates | null = null
await act(async () => {
  conflictRoot.render(<Harness onState={(state) => { conflictState = state }} />)
})
await waitFor(() => !!(conflictState as HomeV2AppUpdates | null)?.preferencesLoaded)
await act(async () => {
  ;(conflictState as HomeV2AppUpdates).setHomeUpdatePolicy('notify')
  ;(conflictState as HomeV2AppUpdates).setHomeUpdatePolicy('off')
})
await waitFor(() => conflictSettings.generation === 7)
assert.equal(conflictSettings.homeUpdatePolicy, 'off')
assert.equal(conflictSettings.releaseChannel, 'prerelease')
assert.equal((conflictState as HomeV2AppUpdates | null)?.channel, 'prerelease')
await act(async () => { conflictRoot.unmount() })
conflictElement.remove()

window.homeV2AppUpdates = undefined
let androidChecks = 0
let androidDownloads = 0
let savedAndroidPreferences = ''
const androidResult: QortiumAppUpdateCheckResult = {
  asset: {
    digest: `sha256:${'c'.repeat(64)}`,
    downloadUrl: 'https://github.com/QortiumDev/qortium-home/releases/download/v2.1.0/Qortium-Home-2.1.0.apk',
    name: 'Qortium-Home-2.1.0.apk',
    size: 123,
  },
  channel: 'prerelease',
  checkedAt: '2026-08-22T12:00:00.000Z',
  comparison: 1,
  currentVersion: '2.0.0',
  message: 'Update available',
  platform: { arch: 'arm64', label: 'Android arm64', os: 'android', supported: true },
  release: {
    channel: 'prerelease',
    htmlUrl: 'https://github.com/QortiumDev/qortium-home/releases/tag/v2.1.0',
    name: 'Home 2.1',
    prerelease: true,
    publishedAt: '2026-08-22T00:00:00.000Z',
    tagName: 'v2.1.0',
  },
  status: 'available',
}
const androidHost: AndroidHomeV2UpdateHost = {
  check: async () => {
    androidChecks += 1
    return androidResult
  },
  client: {
    downloadAsset: async () => {
      androidDownloads += 1
      throw new Error('Android automatic download crossed the native boundary.')
    },
    downloadReleaseAsset: async () => { throw new Error('not used') },
    getEnvironment: async () => ({
      currentVersion: '2.0.0',
      installDir: '',
      installFile: '',
      platform: androidResult.platform,
      updatesDir: '',
    }),
    onDownloadProgress: () => () => undefined,
    openDownloadedFile: async () => undefined,
    openReleasePage: async () => undefined,
    showDownloadedFile: async () => undefined,
  },
  loadPreferences: async () => serializeHomeV2AppUpdatePreferences({
    homeUpdatePolicy: 'auto-download',
    releaseChannel: 'prerelease',
  }),
  savePreferences: async (value) => { savedAndroidPreferences = value },
}
const androidElement = document.createElement('div')
document.body.append(androidElement)
const androidRoot = createRoot(androidElement)
let latestAndroid: HomeV2AppUpdates | null = null
await act(async () => {
  androidRoot.render(<Harness nativeHost={androidHost} onState={(state) => { latestAndroid = state }} />)
})
await waitFor(() => {
  const state = latestAndroid as HomeV2AppUpdates | null
  return !!state?.preferencesLoaded && state.busy === null && androidChecks === 1
})
assert.match(savedAndroidPreferences, /"homeUpdatePolicy":"notify"/)
assert.equal((latestAndroid as HomeV2AppUpdates | null)?.homeUpdatePolicy, 'notify')
await act(async () => {
  await (latestAndroid as HomeV2AppUpdates).check('prerelease', {
    autoDownload: true,
    automaticSettingsGeneration: 7,
  })
})
assert.equal(androidChecks, 2)
assert.equal(androidDownloads, 0)
await act(async () => { androidRoot.unmount() })
androidElement.remove()

const corruptElement = document.createElement('div')
document.body.append(corruptElement)
const corruptRoot = createRoot(corruptElement)
let corruptState: HomeV2AppUpdates | null = null
await act(async () => {
  corruptRoot.render(<Harness
    nativeHost={{ ...androidHost, loadPreferences: async () => '{bad json' }}
    onState={(state) => { corruptState = state }}
  />)
})
await waitFor(() => !!(corruptState as HomeV2AppUpdates | null)?.preferencesLoaded)
assert.equal((corruptState as HomeV2AppUpdates | null)?.homeUpdatePolicy, 'off')
assert.equal(androidChecks, 2)
assert.equal(androidDownloads, 0)
await act(async () => { corruptRoot.unmount() })
corruptElement.remove()

console.log('Home 2 app update controller tests passed.')
