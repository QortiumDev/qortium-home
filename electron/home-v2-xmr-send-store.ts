import * as fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { withFileLock, writeDurableFile } from './durable-json-file.js'
export type XmrSendRecord = {
  account: string; app: string; tab: string; route: string; wallet: string
  handle: string; operation: string; requestHash: string; session: string
  phase: 'PREPARING' | 'COMMITTING'
}
export type XmrSendStore = { get(account: string): XmrSendRecord | null; put(record: XmrSendRecord, previous: string | null): void }
const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
export function createXmrSendStore(userData: string): XmrSendStore {
  const file = path.join(userData, 'home-v2-xmr-sends.json')
  const locked = <T>(use: (rows: XmrSendRecord[]) => T) => withFileLock(file, () => {
    let rows: XmrSendRecord[] = []
    if (fs.existsSync(file)) {
      if (fs.statSync(file).size > 1024 * 1024) throw Error('XMR send journal is unavailable.')
      const envelope = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (envelope.version !== 1 || typeof envelope.payload !== 'string' || createHash('sha256').update(envelope.payload).digest('hex') !== envelope.sha256) throw Error('XMR send journal is unavailable.')
      const parsed: unknown = JSON.parse(envelope.payload)
      if (!Array.isArray(parsed) || parsed.length > 1024) throw Error('XMR send journal is unavailable.')
      const accounts = new Set<string>()
      for (const row of parsed) {
        if (!row || typeof row !== 'object' || Object.keys(row).sort().join(',') !== 'account,app,handle,operation,phase,requestHash,route,session,tab,wallet' ||
            !['account', 'app', 'tab', 'route'].every(k => typeof row[k] === 'string' && row[k].length > 0 && row[k].length < 2048) ||
            !['handle', 'operation', 'session'].every(k => typeof row[k] === 'string' && uuid.test(row[k])) ||
            !['wallet', 'requestHash'].every(k => typeof row[k] === 'string' && /^[a-f0-9]{64}$/.test(row[k])) ||
            !['PREPARING', 'COMMITTING'].includes(row.phase) || accounts.has(row.account)) throw Error('XMR send journal is unavailable.')
        accounts.add(row.account)
      }
      rows = parsed
    }
    return use(rows)
  }, { code: 'XMR_SEND_JOURNAL_LOCKED' })
  return {
    get: account => locked(rows => rows.find(r => r.account === account) ?? null),
    put: (record, previous) => locked(rows => {
      const current = rows.find(r => r.account === record.account)
      if (current?.handle === record.handle && current.phase === 'COMMITTING' && record.phase !== 'COMMITTING') throw Error('XMR send reservation changed.')
      if ((current?.handle ?? null) !== previous) throw Error('XMR send reservation changed.')
      const payload = JSON.stringify([...rows.filter(r => r.account !== record.account), record])
      if (Buffer.byteLength(payload) > 900000) throw Error('XMR send journal is full.')
      writeDurableFile(file, JSON.stringify({ version: 1, payload, sha256: createHash('sha256').update(payload).digest('hex') }), { directorySync: 'required' })
    }),
  }
}
