import { ipcMain } from 'electron'

import { assertAuthorizedHomeV2Sender } from './home-v2-authorized-senders.js'
import { homeV2NodeOrigin } from './home-v2-admin-trust.js'
import {
  clearHomeV2NodeAdminKey,
  getHomeV2NodeAdminKeySummary,
  setHomeV2NodeAdminKey,
} from './home-v2-node-admin-key.js'
import { getNodeSettingsForHomeV2 } from './node-settings.js'

/**
 * The ONLY channel that carries a node administration key, deliberately kept
 * out of the general node bridge: that surface answers snapshots to the
 * renderer, and a contract test asserts no key material appears in it at all.
 * Here the flow is strictly one-way — the key arrives once, goes into the
 * OS-protected store, and is never read back out to any renderer. Callers get
 * only whether a key is attached, and to which origin.
 */
export function registerHomeV2NodeAdminIpcHandlers() {
  ipcMain.handle(
    'home-v2-node-admin:attach',
    async (event, networkValue: unknown, keyValue: unknown) => {
      assertAuthorizedHomeV2Sender(event)
      if (networkValue !== 'qortium') {
        throw new Error('Only a Qortium node can be administered from Home.')
      }
      if (typeof keyValue !== 'string') throw new Error('The node API key must be text.')
      // Bind to the origin the node settings currently resolve to, never to a
      // URL supplied alongside the key: the address the user just saved is
      // the one they are looking at in the dialog.
      const origin = homeV2NodeOrigin((await getNodeSettingsForHomeV2()).nodeApiUrl)
      if (!origin) throw new Error('Save the node address before attaching its API key.')
      setHomeV2NodeAdminKey('qortium', origin, keyValue)
      return getHomeV2NodeAdminKeySummary('qortium')
    },
  )
  ipcMain.handle('home-v2-node-admin:clear', async (event, networkValue: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    if (networkValue !== 'qortium') return { attached: false, origin: '' }
    clearHomeV2NodeAdminKey('qortium')
    return getHomeV2NodeAdminKeySummary('qortium')
  })
}
