#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(command, args, cwd = repoRoot) {
  return spawnSync(command, args, { cwd, stdio: 'inherit' }).status ?? 1
}

let buildStatus = 1
try {
  buildStatus = run('npm', ['run', 'android:sync:v2-live'])
  if (buildStatus === 0) {
    buildStatus = run('./gradlew', ['assembleV2Live'], path.join(repoRoot, 'android'))
  }
} finally {
  const restoreStatus = run('npm', ['run', 'android:sync'])
  if (restoreStatus !== 0) {
    console.error('Failed to restore the standard Android web assets after the v2 preview build.')
    process.exit(restoreStatus)
  }
}

if (buildStatus === 0) {
  buildStatus = run('node', ['scripts/check-home-v2-live-android-artifact.mjs'])
}

process.exit(buildStatus)
