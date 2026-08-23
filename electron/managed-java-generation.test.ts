import assert from 'node:assert/strict'
import { sameManagedJavaGeneration } from './managed-java-generation.js'

const generationA = {
  digest: `sha256:${'a'.repeat(64)}`,
  installedAt: '2026-08-22T00:00:00.000Z',
  installPath: '/java/generation-a',
  javaPath: '/java/generation-a/bin/java',
}
const generationB = {
  ...generationA,
  digest: `sha256:${'b'.repeat(64)}`,
  installedAt: '2026-08-22T00:01:00.000Z',
  installPath: '/java/generation-b',
  javaPath: '/java/generation-b/bin/java',
}

assert.equal(sameManagedJavaGeneration(generationA, { ...generationA }), true)
assert.equal(sameManagedJavaGeneration(generationA, generationB), false)
assert.equal(sameManagedJavaGeneration(generationA, null), false)

for (const field of ['digest', 'installedAt', 'installPath', 'javaPath'] as const) {
  assert.equal(
    sameManagedJavaGeneration(generationA, { ...generationA, [field]: `${generationA[field]}-changed` }),
    false,
  )
}

console.log('Managed Java generation tests passed.')
