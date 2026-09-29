import { createHash } from 'node:crypto'
import { parseArrrSendOperation } from './home-v2-arrr-send.js'
import type { ArrrSendOperation } from './arrr-send-contract.js'
import * as fs from 'node:fs'
import path from 'node:path'
import { withFileLock, writeDurableFile, type DurableFileOps } from './durable-json-file.js'

export type ArrrSendReservation = {
  accountId: string
  appIdentity: string
  route: string
  idempotencyKey: string
  receipt?: ArrrSendOperation
}
/** One unresolved request per account across routes and apps. No spend authority or payment text. */
export function createArrrSendStore(userData: string, fileOps: DurableFileOps = fs) {
  const target = path.join(userData, 'home-v2-arrr-send-reservations.json')
  const locked = <T>(run: (entries: ArrrSendReservation[]) => T): T =>
    withFileLock(
      target,
      () => {
        let entries: ArrrSendReservation[] = []
        if (fileOps.existsSync(target)) {
          const raw = fileOps.readFileSync(target)
          if (raw.length > 1024 * 1024) throw new Error('ARRR send journal is unavailable.')
          const envelope = JSON.parse(raw.toString('utf8'))
          if (
            envelope.version !== 1 ||
            typeof envelope.payload !== 'string' ||
            createHash('sha256').update(envelope.payload).digest('hex') !== envelope.sha256
          )
            throw new Error('ARRR send journal is unavailable.')
          const parsed: unknown = JSON.parse(envelope.payload)
          if (!Array.isArray(parsed)) throw new Error('ARRR send journal is unavailable.')
          const accounts = new Set<string>()
          for (const entry of parsed) {
            if (
              !entry ||
              typeof entry !== 'object' ||
              Object.keys(entry).some(
                (k) => !['accountId', 'appIdentity', 'route', 'idempotencyKey', 'receipt'].includes(k),
              ) ||
              !['accountId', 'appIdentity', 'route', 'idempotencyKey'].every(
                (k) => typeof entry[k] === 'string' && entry[k].length > 0,
              ) ||
              !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(entry.idempotencyKey) ||
              (entry.receipt !== undefined &&
                (!entry.receipt ||
                  !['BROADCAST', 'FAILED'].includes(entry.receipt.state) ||
                  typeof entry.receipt.operationId !== 'string')) ||
              accounts.has(entry.accountId)
            )
              throw new Error('ARRR send journal is unavailable.')
            if (entry.receipt)
              parseArrrSendOperation(entry.receipt, entry.receipt.walletIdentityHash, entry.idempotencyKey)
            accounts.add(entry.accountId)
          }
          entries = parsed
        }
        return run(entries)
      },
      { code: 'ARRR_SEND_JOURNAL_LOCKED', fileOps },
    )
  const write = (entries: ArrrSendReservation[]) => {
    const payload = JSON.stringify(entries)
    if (Buffer.byteLength(payload) > 900000) throw new Error('ARRR send journal is full.')
    writeDurableFile(
      target,
      JSON.stringify({ version: 1, payload, sha256: createHash('sha256').update(payload).digest('hex') }),
      { directorySync: 'required', fileOps },
    )
  }
  return {
    get: (accountId: string) => locked((entries) => entries.find((e) => e.accountId === accountId) ?? null),
    reserve: (entry: ArrrSendReservation, acknowledgedOperationId?: string) =>
      locked((entries) => {
        if (
          entries.some(
            (e) => e.accountId === entry.accountId && (!e.receipt || e.receipt.operationId !== acknowledgedOperationId),
          )
        )
          throw new Error('An ARRR send is already pending for this account.')
        write([...entries.filter((e) => e.accountId !== entry.accountId), entry])
      }),
    recordReceipt: (accountId: string, key: string, receipt: ArrrSendOperation) =>
      locked((entries) => {
        if (!['BROADCAST', 'FAILED'].includes(receipt.state)) throw new Error('ARRR operation is not terminal.')
        const current = entries.find((e) => e.accountId === accountId)
        if (!current || current.idempotencyKey !== key) throw new Error('ARRR reservation changed.')
        write(entries.map((e) => (e === current ? { ...e, receipt } : e)))
      }),
  }
}
export type ArrrSendStore = ReturnType<typeof createArrrSendStore>
