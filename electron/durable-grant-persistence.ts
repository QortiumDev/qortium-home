/**
 * Writing a durable ("always allow") capability grant and confirming it stuck.
 *
 * A durable grant has two failure modes that must both degrade to the narrower
 * session grant rather than to a denial or to a false belief:
 *
 * - the write THROWS, for an app principal the capability store refuses; and
 * - the write RETURNS NORMALLY but persists nothing, because the store's own
 *   sanitizer discards the key when it reads the file back. That one is
 *   silent: without a confirming read the caller returns as though the user's
 *   "always" answer had been recorded, and the grant simply vanishes.
 *
 * Both are handled the same way here: write, then re-read. Callers treat a
 * false result as "fall back to a session grant", never as "deny" — the user
 * has already approved the request by the time this runs, and never as "widen"
 * — the fallback is always the narrower grant.
 */

export type DurableGrantReport = (message: string) => void

function fallbackMessage(capability: string): string {
  return `[home-v2] Could not persist the durable ${capability} grant; using a session grant instead.`
}

export function persistDurableGrant(input: {
  readonly capability: string
  readonly isHeld: () => boolean
  readonly onFallback?: DurableGrantReport
  readonly write: () => void
}): boolean {
  try {
    input.write()
    if (input.isHeld()) return true
  } catch {
    // Fall through to the shared report below.
  }
  ;(input.onFallback ?? console.warn)(fallbackMessage(input.capability))
  return false
}

export async function persistDurableGrantAsync(input: {
  readonly capability: string
  readonly isHeld: () => Promise<boolean> | boolean
  readonly onFallback?: DurableGrantReport
  readonly write: () => Promise<void> | void
}): Promise<boolean> {
  try {
    await input.write()
    if (await input.isHeld()) return true
  } catch {
    // Fall through to the shared report below.
  }
  ;(input.onFallback ?? console.warn)(fallbackMessage(input.capability))
  return false
}
