import { useEffect, useState } from 'react'
import type { DualIdentityLookupResult } from '../v2/contracts'

export type TabIdentityTarget = { readonly id: string; readonly address: string }
export type TabIdentityLookup = (address: string) => Promise<DualIdentityLookupResult>
const RETRY_DELAY_MS = 30_000
const EMPTY_IDENTITIES: ReadonlyMap<string, DualIdentityLookupResult> = new Map()

/** Resolve tab accounts independently of tab ordering, navigation and lock state. */
export function useTabAccountIdentities(
  targets: readonly TabIdentityTarget[],
  lookup: TabIdentityLookup | undefined,
): ReadonlyMap<string, DualIdentityLookupResult> {
  const targetKey = JSON.stringify(
    [...new Map(targets.map(({ id, address }) => [id, address])).entries()]
      .sort(([a], [b]) => a.localeCompare(b)),
  )
  const [resolved, setResolved] = useState({
    key: '',
    identities: EMPTY_IDENTITIES,
  })

  useEffect(() => {
    if (!lookup) return
    let cancelled = false
    let retry: number | undefined
    const identities = new Map<string, DualIdentityLookupResult>()
    const accounts = JSON.parse(targetKey) as [string, string][]
    const resolve = async (pending: [string, string][]) => {
      const next = await Promise.all(pending.map(async ([id, address]) => {
        try {
          const result = await lookup(address)
          if (cancelled) return null
          identities.set(id, result)
          setResolved({ key: targetKey, identities: new Map(identities) })
          return result.state === 'unavailable' || result.state === 'partial'
            ? [id, address] as [string, string] : null
        } catch {
          return [id, address] as [string, string]
        }
      }))
      const unresolved = next.filter((entry): entry is [string, string] => entry !== null)
      if (!cancelled && unresolved.length) {
        retry = window.setTimeout(() => { void resolve(unresolved) }, RETRY_DELAY_MS)
      }
    }
    void resolve(accounts)
    return () => {
      cancelled = true
      if (retry !== undefined) window.clearTimeout(retry)
    }
  }, [lookup, targetKey])

  // Never show an old account's image after an account is removed or rebound.
  return lookup && resolved.key === targetKey ? resolved.identities : EMPTY_IDENTITIES
}
