import assert from 'node:assert/strict'
import { runI2pdUpdateTransaction } from './i2pd-update-transaction.js'

function harness(options: Readonly<{
  failInstall?: boolean
  failRestore?: boolean
  restartPreviousOnFailure?: boolean
}> = {}) {
  const events: string[] = []
  return {
    events,
    operations: {
      async installAndStart() {
        events.push('install-and-start')
        if (options.failInstall) throw new Error('candidate failed readiness')
        return 'updated'
      },
      async restartPrevious() {
        events.push('restart-previous')
      },
      restartPreviousOnFailure: options.restartPreviousOnFailure ?? false,
      async restorePrevious() {
        events.push('restore-previous')
        if (options.failRestore) throw new Error('activation failed')
      },
      async stopCandidate() {
        events.push('stop-candidate')
      },
    },
  }
}

{
  const test = harness()
  assert.equal(await runI2pdUpdateTransaction(test.operations), 'updated')
  assert.deepEqual(test.events, ['install-and-start'])
}

{
  const test = harness({ failInstall: true })
  await assert.rejects(
    runI2pdUpdateTransaction(test.operations),
    /previous release was restored/,
  )
  assert.deepEqual(test.events, ['install-and-start', 'stop-candidate', 'restore-previous'])
}

{
  const test = harness({ failInstall: true, restartPreviousOnFailure: true })
  await assert.rejects(
    runI2pdUpdateTransaction(test.operations),
    /previous release was restored/,
  )
  assert.deepEqual(test.events, [
    'install-and-start',
    'stop-candidate',
    'restore-previous',
    'restart-previous',
  ])
}

{
  const test = harness({ failInstall: true, failRestore: true })
  await assert.rejects(
    runI2pdUpdateTransaction(test.operations),
    /could not be fully restored/,
  )
  assert.deepEqual(test.events, ['install-and-start', 'stop-candidate', 'restore-previous'])
}

console.log('i2pd update transaction rollback checks passed.')
