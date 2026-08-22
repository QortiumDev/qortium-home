import assert from 'node:assert/strict'
import path from 'node:path'
import { resolvePrivateHomeV2AppUpdateTarget } from './app-update-paths.js'

const root = path.resolve('/private/home/app-updates')
const target = resolvePrivateHomeV2AppUpdateTarget(
  root,
  '../../Qortium Home.AppImage',
  '../../../v2.1.0',
)

assert.equal(target.fileName, '.._.._Qortium_Home.AppImage')
assert.equal(path.resolve(target.finalPath).startsWith(`${root}${path.sep}`), true)
assert.equal(
  target.finalPath,
  path.join(root, '.._.._.._v2.1.0', '.._.._Qortium_Home.AppImage'),
)

console.log('Home 2 private app update path tests passed.')
