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
  if (escaped.length > 4_000) {
    throw new Error(`${label} is too large to display safely for approval (4000 characters maximum).`)
  }
  return escaped
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
