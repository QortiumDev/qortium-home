/**
 * Unwrapping for node reads the Android signing arms hold their prompts to.
 *
 * FETCH_NODE_API / FETCH_QORTAL_NODE_API answer a response ENVELOPE — status,
 * headers, and the parsed body under `data` — not the record itself. Every
 * Android arm that reads live chain state before raising an approval goes
 * through here, because handing the envelope straight to a selector produces
 * "the lookup answered with an unrecognized shape": a message that blames the
 * node for what is actually a wiring mistake, on a path a unit test cannot
 * reach.
 *
 * A missing target gets its own message, distinct from a transport failure,
 * so the app can tell "no such name" from "the node would not answer".
 */
export function unwrapAndroidNodeRecord(response: unknown, missingMessage: string): unknown {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) {
    throw new Error('The node answered the lookup with an unrecognized shape.')
  }
  const envelope = response as Record<string, unknown>
  if (envelope.status === 404) throw new Error(missingMessage)
  if (envelope.ok !== true) {
    const status = typeof envelope.status === 'number' ? envelope.status : 0
    throw new Error(
      status > 0
        ? `The node lookup returned HTTP ${status}.`
        : 'The node lookup failed.',
    )
  }
  return envelope.data
}
