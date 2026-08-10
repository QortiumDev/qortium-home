#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apkPath = path.join(
  repoRoot,
  'android/app/build/outputs/apk/v2Live/Qortium-Home-1.6.3-v2-live-android-v2Live.apk',
)
const archive = await JSZip.loadAsync(await readFile(apkPath))

for (const required of [
  'assets/capacitor.config.json',
  'assets/capacitor.plugins.json',
  'assets/public/index.html',
]) {
  if (!archive.file(required)) throw new Error(`Android preview is missing ${required}.`)
}
for (const forbidden of [
  'assets/public/v2-live.html',
  'assets/public/assets/pdf.worker-BgryrOlp.mjs',
]) {
  if (archive.file(forbidden)) throw new Error(`Android preview contains ${forbidden}.`)
}

const capacitorConfig = JSON.parse(
  await archive.file('assets/capacitor.config.json').async('string'),
)
if (capacitorConfig.appId !== 'org.qortium.home.v2live') {
  throw new Error('Android preview uses the wrong Capacitor application ID.')
}
if (capacitorConfig.loggingBehavior !== 'none') {
  throw new Error('Android preview must not emit complete Capacitor bridge payloads.')
}
const plugins = JSON.parse(
  await archive.file('assets/capacitor.plugins.json').async('string'),
)
const pluginClasses = JSON.stringify(plugins)
for (const forbiddenPlugin of [
  'QdnFileSaverPlugin',
  'QdnPublishSourcePlugin',
  'UpdateInstallerPlugin',
  'WalletBackupPlugin',
]) {
  if (pluginClasses.includes(forbiddenPlugin)) {
    throw new Error(`Android preview registers forbidden plugin ${forbiddenPlugin}.`)
  }
}

const badging = execFileSync('aapt2', ['dump', 'badging', apkPath], {
  encoding: 'utf8',
})
if (!badging.includes("package: name='org.qortium.home.v2live'")) {
  throw new Error('Android preview package ID audit failed.')
}
if (!badging.includes("application-label:'Qortium Home 2 Live Preview'")) {
  throw new Error('Android preview label audit failed.')
}

console.log(
  `Verified Home v2 Android live-preview artifact (${Object.keys(archive.files).length} archive entries, v2 renderer and temporary package identity).`,
)
