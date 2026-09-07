import { useId } from 'react'

/**
 * DOM ids that are unique per component INSTANCE.
 *
 * Internal pages stay mounted one per tab, and the Core maintenance panel is
 * rendered once per network, so any static `id=` in them appears several times
 * in a single document. A repeated id is not cosmetic: `aria-labelledby`,
 * `aria-describedby` and `htmlFor` all resolve to the FIRST match, so the
 * second Settings tab's controls were labelled and described by the first
 * tab's text.
 *
 * The readable name stays the PREFIX and React's per-instance token is
 * appended, so the id is still recognisable in devtools and reachable from a
 * smoke test with `[id^="core-settings-title"]`.
 */
export function useScopedIds(): (name: string) => string {
  const scope = useId()
  return (name: string) => `${name}${scope}`
}
