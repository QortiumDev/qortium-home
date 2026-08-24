declare global {
  interface Window {
    homeV2Zoom?: {
      step: (direction: 'in' | 'out') => Promise<void>
    }
  }
}

// Steps the native window zoom (the same zoom Ctrl/Cmd +/- drive from the
// main process). Absent on Android, where pinch zoom is native.
export function stepHomeV2WindowZoom(direction: 'in' | 'out') {
  return window.homeV2Zoom?.step(direction)
}
