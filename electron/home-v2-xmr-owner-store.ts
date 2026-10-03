import * as fs from 'node:fs'
import path from 'node:path'
import { withFileLock, writeDurableFile } from './durable-json-file.js'
import { parseXmrSession } from './xmr-wallet-contract.js'

/** Cleanup authority only. Never store account seeds, API keys, or credential digests. */
export type XmrOwnerRecord = {
  nodeApiUrl: string
  walletId: string
  session: string | null
  previousSession: string | null
}
export type XmrOwnerStore = {
  list(): XmrOwnerRecord[]
  get(url: string): XmrOwnerRecord | undefined
  put(record: XmrOwnerRecord): void
  remove(record: XmrOwnerRecord): void
}
export function createXmrOwnerStore(userData: string): XmrOwnerStore {
  const target = path.join(userData, 'home-v2-xmr-custody.json')
  const locked = <T>(use: (rows: XmrOwnerRecord[]) => T): T =>
    withFileLock(
      target,
      () => {
        let rows: XmrOwnerRecord[] = []
        if (fs.existsSync(target)) {
          if (fs.statSync(target).size > 65536)
            throw new Error('XMR cleanup journal is unavailable.')
          const value: unknown = JSON.parse(fs.readFileSync(target, 'utf8'))
          if (!Array.isArray(value) || value.length > 32)
            throw new Error('XMR cleanup journal is unavailable.')
          const urls = new Set<string>()
          rows = value.map((v) => {
            if (
              !v ||
              typeof v !== 'object' ||
              Object.keys(v).some(
                (k) => !['nodeApiUrl', 'walletId', 'session', 'previousSession'].includes(k),
              )
            )
              throw new Error('Invalid XMR cleanup record.')
            const url = new URL(v.nodeApiUrl)
            if (
              !['http:', 'https:'].includes(url.protocol) ||
              !['127.0.0.1', '[::1]'].includes(url.hostname) ||
              url.username ||
              url.password ||
              url.search ||
              url.hash ||
              url.pathname !== '/' ||
              urls.has(v.nodeApiUrl)
            )
              throw new Error('Invalid XMR cleanup route.')
            urls.add(v.nodeApiUrl)
            parseXmrSession({ sessionId: v.session, walletId: v.walletId, state: 'IDLE' })
            parseXmrSession({ sessionId: v.previousSession, walletId: v.walletId, state: 'IDLE' })
            if (!v.walletId) throw new Error('Invalid XMR cleanup identity.')
            return {
              nodeApiUrl: v.nodeApiUrl,
              walletId: v.walletId,
              session: v.session,
              previousSession: v.previousSession,
            }
          })
        }
        return use(rows)
      },
      { code: 'XMR_CUSTODY_JOURNAL_LOCKED' },
    )
  const write = (rows: XmrOwnerRecord[]) => {
    if (rows.length > 32) throw new Error('XMR cleanup journal is full.')
    writeDurableFile(target, JSON.stringify(rows), { directorySync: 'required' })
  }
  return {
    list: () => locked((rows) => rows.map((r) => ({ ...r }))),
    get: (url) => locked((rows) => rows.find((row) => row.nodeApiUrl === url)),
    put: (record) =>
      locked((rows) =>
        write([...rows.filter((row) => row.nodeApiUrl !== record.nodeApiUrl), record]),
      ),
    remove: (record) =>
      locked((rows) => write(rows.filter((row) => JSON.stringify(row) !== JSON.stringify(record)))),
  }
}
