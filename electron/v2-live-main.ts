import { app } from 'electron'
import path from 'node:path'

process.env.QORTIUM_HOME_V2_LIVE = '1'
process.env.QORTIUM_HOME_USER_DATA_DIR = path.join(
  app.getPath('appData'),
  'qortium-home-v2-live',
)

await import('./main.js')
