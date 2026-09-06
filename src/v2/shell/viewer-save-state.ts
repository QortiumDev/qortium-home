export type ViewerSaveState = {
  readonly phase: 'idle' | 'saving' | 'saved' | 'canceled' | 'error'
  readonly filename: string
}
const idle: ViewerSaveState = { phase: 'idle', filename: '' }
type Entry = { state: ViewerSaveState; listeners: Set<() => void> }
export type ViewerSaveKey = string | object

// Ephemeral UI state only: no bytes, capabilities, native paths, retries or account
// authority are retained. Pending saves survive active-only viewer unmounts so
// switching away and back cannot launch a second native save dialog.
export function createViewerSaveStore() {
  const entries = new Map<ViewerSaveKey, Entry>()
  const get = (key: ViewerSaveKey) => {
    let entry = entries.get(key)
    if (!entry) { entry = { state: idle, listeners: new Set() }; entries.set(key, entry) }
    return entry
  }
  const release = (key: ViewerSaveKey, entry: Entry) => {
    if (!entry.listeners.size && entry.state.phase !== 'saving' && entries.get(key) === entry) entries.delete(key)
  }
  return {
    snapshot: (key: ViewerSaveKey): ViewerSaveState => entries.get(key)?.state ?? idle,
    subscribe(key: ViewerSaveKey, listener: () => void) {
      const entry = get(key)
      entry.listeners.add(listener)
      return () => { entry.listeners.delete(listener); release(key, entry) }
    },
    async run(key: ViewerSaveKey, filename: string, operation: () => Promise<{ canceled: boolean }>) {
      const entry = get(key)
      if (entry.state.phase === 'saving') return
      const notify = () => entry.listeners.forEach(listener => listener())
      entry.state = { phase: 'saving', filename }
      notify()
      try {
        const result = await operation()
        entry.state = { phase: result.canceled ? 'canceled' : 'saved', filename }
      } catch {
        // Do not expose native filesystem paths, stream tokens or upstream URLs.
        entry.state = { phase: 'error', filename }
      } finally {
        notify()
        release(key, entry)
      }
    },
  }
}

export const viewerSaveStore = createViewerSaveStore()
