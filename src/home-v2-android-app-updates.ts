import { checkAppUpdates } from './appUpdates'

export type AndroidHomeV2UpdateHost = {
  readonly check: typeof checkAppUpdates
  readonly client: Window['qortiumHome']['updates']
}

export function createAndroidHomeV2UpdateHost(): AndroidHomeV2UpdateHost | null {
  const client = window.qortiumHome?.updates
  return client ? { check: checkAppUpdates, client } : null
}
