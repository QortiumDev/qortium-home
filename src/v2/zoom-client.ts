declare global {
  interface Window {
    homeV2Zoom?: {
      step: (direction: 'in' | 'out') => Promise<void>
      set?: (percent: number) => Promise<number>
      onChanged?: (listener: (percent: number) => void) => () => void
    }
  }
}

/** True when the window can be zoomed natively (desktop shell only). */
export function hasHomeV2NativeZoom(): boolean {
  return typeof window !== 'undefined' && typeof window.homeV2Zoom?.set === 'function'
}

/** Applies the app-zoom preference to the real window zoom. */
export function setHomeV2WindowZoom(percent: number) {
  return window.homeV2Zoom?.set?.(percent)
}

/** Follows zoom changes made with the keyboard or Ctrl+wheel. */
export function subscribeHomeV2WindowZoom(listener: (percent: number) => void) {
  return window.homeV2Zoom?.onChanged?.(listener)
}

// Steps the native window zoom (the same zoom Ctrl/Cmd +/- drive from the
// main process). Absent on Android, where pinch zoom is native.
export function stepHomeV2WindowZoom(direction: 'in' | 'out') {
  return window.homeV2Zoom?.step(direction)
}
