export type I2pdUpdateTransactionOperations<T> = Readonly<{
  installAndStart: () => Promise<T>
  restartPrevious: () => Promise<void>
  restartPreviousOnFailure: boolean
  restorePrevious: () => Promise<void>
  stopCandidate: () => Promise<void>
}>

/**
 * Runs the fallible part of an i2pd update after the caller has proved that the
 * old trusted generation is stopped. The old current record is restored on
 * every failure; a router that had been running is also restarted.
 */
export async function runI2pdUpdateTransaction<T>(
  operations: I2pdUpdateTransactionOperations<T>,
): Promise<T> {
  try {
    return await operations.installAndStart()
  } catch (updateError) {
    try {
      await operations.stopCandidate()
      await operations.restorePrevious()
      if (operations.restartPreviousOnFailure) await operations.restartPrevious()
    } catch (rollbackError) {
      throw new Error(
        'The i2pd update failed and the previous release could not be fully restored.',
        { cause: new AggregateError([updateError, rollbackError]) },
      )
    }
    throw new Error('The i2pd update failed; the previous release was restored.', {
      cause: updateError,
    })
  }
}
