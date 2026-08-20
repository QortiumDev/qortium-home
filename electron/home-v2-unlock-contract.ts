export function assertHomeV2UnlockCompleted(
  accountId: string,
  isUnlocked: (accountId: string) => boolean,
) {
  if (!isUnlocked(accountId)) {
    throw new Error('The account was not unlocked.')
  }
}
