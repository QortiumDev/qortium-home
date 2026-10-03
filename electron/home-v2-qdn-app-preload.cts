const { contextBridge, ipcRenderer, webFrame } = require('electron') as typeof import('electron')

const ERROR_KEY = '__qdnBridgeError_9f5f01d1'
const RESULT_KEY = '__qdnBridgeResult_9f5f01d1'

// Transfer plain envelopes through contextBridge. Error custom properties are
// lost when an Error itself crosses the isolated-world boundary.
contextBridge.exposeInMainWorld('__homeV2RequestRaw', (protocol: 'qdnRequest' | 'qortalRequest', value: unknown) =>
  ipcRenderer.invoke('home-v2-app:request', protocol, value),
)

function installRequests(errorKey: string, resultKey: string) {
  const raw = (window as unknown as {
    __homeV2RequestRaw: (protocol: string, value: unknown) => Promise<unknown>
  }).__homeV2RequestRaw
  for (const protocol of ['qdnRequest', 'qortalRequest']) {
    Object.defineProperty(window, protocol, {
      configurable: false, enumerable: true, writable: false,
      value: async (value: unknown) => {
        const envelope = await raw(protocol, value)
        if (envelope && typeof envelope === 'object' && !Array.isArray(envelope) && Object.keys(envelope).length === 1) {
          const record = envelope as Record<string, unknown>
          if (resultKey in record) return record[resultKey]
          const payload = record[errorKey]
          if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            const error = payload as Record<string, unknown>
            if (typeof error.message === 'string') {
              throw Object.assign(new Error(error.message),
                Object.fromEntries(Object.entries(error).filter(([key]) => key !== 'message')))
            }
          }
        }
        throw new Error('Malformed Home v2 app bridge response.')
      },
    })
  }
}

if (typeof contextBridge.executeInMainWorld === 'function') {
  contextBridge.executeInMainWorld({ func: installRequests, args: [ERROR_KEY, RESULT_KEY] })
} else {
  // Electron 32 compatibility: only trusted static code and fixed keys enter
  // the page world, matching the legacy QDN preload installer.
  const source = `(${installRequests.toString()})(${JSON.stringify(ERROR_KEY)},${JSON.stringify(RESULT_KEY)})`
  let completed = false
  let executionError: Error | null = null
  void webFrame.executeJavaScript(source, false, (_result, error) => {
    completed = true
    executionError = error ?? null
  })
  if (!completed) throw new Error('Electron 32 did not install the Home v2 app bridge during preload.')
  if (executionError) throw executionError
}

// Main sends only a request id, protocol, action and advisory phase.
ipcRenderer.on('home-v2-app:publish-progress', (_event, message) => {
  // QDN documents have a real origin. A torn-down/opaque document needs no update.
  if (window.location.origin !== 'null') window.postMessage(message, window.location.origin)
})
