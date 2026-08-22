import { app } from 'electron'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  parseLegacyCoreUpdateSettings,
  parseLegacyJavaAutoUpdateSettings,
  type HomeV2CoreUpdatePolicy,
  type WritableHomeV2CoreUpdatePolicySettings,
} from './home-v2-core-update-policy-codec.js'
import { createHomeV2CoreUpdatePolicyFile } from './home-v2-core-update-policy-file.js'

const POLICY_DIRECTORY = 'home-v2-core-maintenance'
const POLICY_FILE = 'update-policy.json'

async function readLegacyPolicy(): Promise<WritableHomeV2CoreUpdatePolicySettings> {
  try {
    const parsed: unknown = JSON.parse(await readFile(
      path.join(app.getPath('appData'), 'qortium-core', 'update-settings.json'),
      'utf8',
    ))
    const legacy = parseLegacyCoreUpdateSettings(parsed)
    if (legacy) return legacy
  } catch {
    // A missing or malformed legacy file grants no automatic authority.
  }

  let javaUpdatePolicy: HomeV2CoreUpdatePolicy = 'notify'
  try {
    const parsed: unknown = JSON.parse(await readFile(
      path.join(app.getPath('appData'), 'qortium-core', 'java', 'java-settings.json'),
      'utf8',
    ))
    javaUpdatePolicy = parseLegacyJavaAutoUpdateSettings(parsed) ?? 'notify'
  } catch {
    // Notify is the safe missing-file default.
  }
  return { coreUpdatePolicy: 'notify', javaUpdatePolicy }
}

const policyFile = createHomeV2CoreUpdatePolicyFile(
  () => path.join(app.getPath('userData'), POLICY_DIRECTORY, POLICY_FILE),
  readLegacyPolicy,
)

export async function readHomeV2CoreUpdatePolicySettings() {
  return await policyFile.read()
}

export async function replaceHomeV2CoreUpdatePolicySettings(
  expectedGeneration: number,
  settings: WritableHomeV2CoreUpdatePolicySettings,
) {
  return await policyFile.replace(expectedGeneration, settings)
}
