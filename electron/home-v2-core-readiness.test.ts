import assert from 'node:assert/strict'
import path from 'node:path'
import {
  detectHomeV2CoreInstall,
  getHomeV2CoreJarCandidates,
  parseQortalHubDirectory,
} from './home-v2-core-readiness-policy.js'

const linuxContext = {
  appDataPath: '/home/alice/.config',
  homePath: '/home/alice',
  platform: 'linux' as const,
  qortalHubDirectory: '/srv/qortal-custom',
}

assert.equal(
  parseQortalHubDirectory({ qortalDirectory: ' /srv/qortal-custom ' }),
  '/srv/qortal-custom',
)
assert.equal(parseQortalHubDirectory({ qortalDirectory: '' }), null)
assert.deepEqual(getHomeV2CoreJarCandidates('qortium', linuxContext), [
  path.resolve('/home/alice/.config/qortium-core/install/qortium.jar'),
])
assert.deepEqual(getHomeV2CoreJarCandidates('qortal', linuxContext), [
  path.resolve('/home/alice/.config/qortal-core/install/qortal.jar'),
  path.resolve('/home/alice/.config/qortal-core/qortal.jar'),
  path.resolve('/home/alice/qortal/qortal.jar'),
  path.resolve('/home/alice/Qortal/qortal.jar'),
  path.resolve('/srv/qortal-custom/qortal.jar'),
])
assert.equal(
  detectHomeV2CoreInstall(
    'qortal',
    linuxContext,
    (candidate) => candidate === path.resolve('/srv/qortal-custom/qortal.jar'),
  ),
  'installed',
)
assert.equal(
  detectHomeV2CoreInstall('qortal', linuxContext, () => false),
  'not-detected',
)
assert.equal(
  detectHomeV2CoreInstall(
    'qortium',
    { ...linuxContext, platform: 'aix' },
    () => true,
  ),
  'unsupported',
)

console.log('Home v2 local Core readiness tests passed.')
