/**
 * How a click on one of Home's own links — a pinned app, a bookmark-toolbar
 * entry, the Dashboard's Apps and Explore buttons — should open its target.
 *
 * Browser convention, applied to Home chrome: a plain left click goes where
 * the user already is (the Dashboard navigates in place), while the middle
 * button or a Ctrl/Cmd-modified left click asks for a new tab. Shift is
 * deliberately NOT a modifier here: in browsers it means a new window, which
 * these links do not offer, so a Shift-click stays a plain open rather than
 * silently meaning something else. Touch and keyboard activations carry no
 * modifier and stay plain opens; long-press and the context menu offer
 * "Open in new tab" for them.
 */
export type HomeV2ChromeOpenOptions = Readonly<{ newTab: boolean }>

export const CHROME_OPEN_IN_PLACE: HomeV2ChromeOpenOptions = Object.freeze({ newTab: false })
export const CHROME_OPEN_NEW_TAB: HomeV2ChromeOpenOptions = Object.freeze({ newTab: true })

export function chromeOpenOptions(event: {
  readonly button: number
  readonly ctrlKey: boolean
  readonly metaKey: boolean
}): HomeV2ChromeOpenOptions {
  if (event.button === 1) return CHROME_OPEN_NEW_TAB
  if (event.button === 0 && (event.ctrlKey || event.metaKey)) return CHROME_OPEN_NEW_TAB
  return CHROME_OPEN_IN_PLACE
}

/** True for the one auxiliary button that means "new tab": the middle one. */
export function isMiddleButton(event: { readonly button: number }) {
  return event.button === 1
}
