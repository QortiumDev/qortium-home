/**
 * Prompt-text escaping shared by the desktop bridge and the Android shell.
 *
 * Both platforms must escape user-derived approval rows the SAME way, because
 * both are validated against the same per-action row contracts. Keeping one
 * implementation is the point: a second copy that drifted would let a value
 * render differently on one platform than the reviewer of the other expects.
 */

/**
 * Escapes one value to bounded printable ASCII for display in an approval row.
 *
 * The backslash is doubled FIRST, which makes the escape injective: no escaped
 * output can be produced by two different inputs, so a crafted value cannot
 * forge the appearance of other rows or reorder text with bidi controls.
 */
export function homeV2PromptText(value: string, label: string) {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(
      /[\u0000-\u001f\u007f-\uffff]/g,
      (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
    )
    // The double quote is escaped too, so a row may QUOTE an app-derived
    // value and have the quotes mean something. Rows that append Home's own
    // annotation to a value — "(unchanged)" on an update prompt — were
    // otherwise forgeable: an app could send the literal string "(unchanged)"
    // as the new name, or end a new description with " (unchanged)", and the
    // row would render byte-identically to the one that says the field is
    // being kept (group family review, 2026-08-27).
    .split('"').join('\\u0022')
  if (escaped.length > 4_000) {
    throw new Error(`${label} is too large to display safely for approval (4000 characters maximum).`)
  }
  return escaped
}

/**
 * One app-derived value as a QUOTED prompt row fragment.
 *
 * Use this wherever Home appends its own words to a value. The quotes cannot
 * occur inside the escaped value, so `"(unchanged)"` (a rename TO that string)
 * and `(unchanged)` (the field is being kept) are unambiguous.
 */
export function homeV2QuotedPromptText(value: string, label: string) {
  return `"${homeV2PromptText(value, label)}"`
}

/**
 * INJECTIVE resource-coordinate display: `service/name/identifier` with each
 * component escaped and any literal '/' inside a component rendered as its
 * \uXXXX escape, so the joined line parses back to exactly one triple.
 *
 * Without this an identifier of "b/c" renders WEBSITE/alice/b/c, which reads
 * as name "alice/b", identifier "c" — the same ambiguity the avatar pointer
 * encoding below was written to remove (publishing-extras review,
 * 2026-08-27). Identifiers legitimately allow '/', so escaping is the fix
 * rather than rejecting them.
 */
export function homeV2ResourceCoordinateText(resource: {
  readonly identifier?: string | null
  readonly name: string
  readonly service: string
}) {
  const component = (value: string, label: string) =>
    homeV2PromptText(value, label).split('/').join('\\u002f')
  return [
    component(resource.service, 'The resource service'),
    component(resource.name, 'The resource name'),
    component(resource.identifier || 'default', 'The resource identifier'),
  ].join('/')
}

/**
 * INJECTIVE avatar-pointer display: each component is escaped to printable
 * ASCII and any literal '/' inside a component becomes its \uXXXX escape, so
 * the joined 'service/name/identifier' line parses back to exactly one
 * component triple — a name of "a/b" can no longer masquerade as a different
 * coordinate (avatar family review, round 1).
 */
export function homeV2AvatarPointerText(
  pointer: { readonly identifier: string; readonly name: string; readonly service: string },
) {
  const component = (value: string, label: string) =>
    homeV2PromptText(value, label).split('/').join('\\u002f')
  return [
    component(pointer.service, 'The avatar service'),
    component(pointer.name, 'The avatar name'),
    component(pointer.identifier || 'default', 'The avatar identifier'),
  ].join('/')
}
