export type UnlockAccountTab = {
  readonly context: { readonly identityId: string }
  readonly id: string
}

export type UnlockAccountStateRequest = {
  readonly accountId: string
  readonly isUnlocked: true
  readonly tabId: string
}

function boundAccountId(tab: UnlockAccountTab) {
  return String(tab.context.identityId).replace(/^home-v2:identity:/, '')
}

export async function completeUnlockAfterAccountStatePropagation(input: {
  readonly accountId: string
  readonly completeAndroid?: () => Promise<void>
  readonly resolveDesktop?: () => void
  readonly tabs: readonly UnlockAccountTab[]
  readonly updateAccountState?: (
    request: UnlockAccountStateRequest,
  ) => Promise<void> | undefined
}) {
  const updates: Promise<void>[] = []

  for (const tab of input.tabs) {
    const boundId = boundAccountId(tab)

    if (boundId !== input.accountId && !boundId.startsWith(`${input.accountId}:`)) {
      continue
    }

    const update = input.updateAccountState?.({
      accountId: boundId,
      isUnlocked: true,
      tabId: tab.id,
    })

    if (update) updates.push(update)
  }

  await Promise.all(updates)

  if (input.completeAndroid) {
    await input.completeAndroid()
  } else {
    input.resolveDesktop?.()
  }
}
