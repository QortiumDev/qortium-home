export function assertHomeV2UnlockCompleted(
  accountId: string,
  isUnlocked: (accountId: string) => boolean,
) {
  if (!isUnlocked(accountId)) {
    throw new Error('The account was not unlocked.')
  }
}

/**
 * Whether UNLOCK_SELECTED_ACCOUNT has anything to ask.
 *
 * An unlock request for an account that is ALREADY unlocked is answered
 * without the password dialog (owner decision 2026-09-20): the dialog would
 * ask the user to prove something Home already knows, and the result it
 * returns is the same selected-account profile GET_SELECTED_ACCOUNT hands out
 * permissionlessly. The locked path is unchanged — it always prompts, is
 * never a session or durable grant, and still asserts the unlock actually
 * completed (assertHomeV2UnlockCompleted) before the action returns.
 *
 * Callers must read this AFTER their last await and before the prompt
 * decision; a lock that lands during an await is a locked account.
 */
export function homeV2UnlockPromptRequired(
  accountId: string,
  isUnlocked: (accountId: string) => boolean,
): boolean {
  return !isUnlocked(accountId)
}

/**
 * Runs an UNLOCK_SELECTED_ACCOUNT request against an injected prompt.
 *
 * This is the behaviour the bridge's permission gate implements for the
 * action, expressed over three callbacks so it can be exercised without
 * Electron: `isUnlocked` is the live lock state, `prompt` raises the
 * single-request permission request and resolves once the user has answered
 * (rejecting on denial), and the unlock is asserted afterwards. An account
 * that is already unlocked resolves WITHOUT ever calling `prompt`; a locked
 * one calls it exactly once and still fails if the account is not unlocked
 * when the prompt resolves. `assertHomeV2UnlockCompleted` reads `isUnlocked`
 * again after the await, never a value captured before it.
 */
export async function requireHomeV2Unlock(input: {
  readonly accountId: string
  readonly isUnlocked: (accountId: string) => boolean
  readonly prompt: () => Promise<void>
}): Promise<'already-unlocked' | 'prompted'> {
  if (!homeV2UnlockPromptRequired(input.accountId, input.isUnlocked)) return 'already-unlocked'
  await input.prompt()
  assertHomeV2UnlockCompleted(input.accountId, input.isUnlocked)
  return 'prompted'
}
