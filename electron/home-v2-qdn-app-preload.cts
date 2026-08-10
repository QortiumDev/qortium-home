const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

const ERROR_KEY = '__qdnBridgeError_9f5f01d1'
const RESULT_KEY = '__qdnBridgeResult_9f5f01d1'

async function request(protocol: 'qdnRequest' | 'qortalRequest', value: unknown) {
  const envelope = await ipcRenderer.invoke('home-v2-app:request', protocol, value)
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('Malformed Home v2 app bridge response.')
  }
  const record = envelope as Record<string, unknown>
  if (RESULT_KEY in record) return record[RESULT_KEY]
  const payload = record[ERROR_KEY]
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const message = (payload as Record<string, unknown>).message
    throw new Error(typeof message === 'string' ? message : 'Home v2 app request failed.')
  }
  throw new Error('Malformed Home v2 app bridge response.')
}

contextBridge.exposeInMainWorld('qdnRequest', (value: unknown) =>
  request('qdnRequest', value),
)
contextBridge.exposeInMainWorld('qortalRequest', (value: unknown) =>
  request('qortalRequest', value),
)
