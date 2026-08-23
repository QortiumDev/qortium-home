import assert from 'node:assert/strict'
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assertSafeZipEntry, extractZipSafely } from './safe-zip-extraction.js'

function crc32(input: Buffer) {
  let crc = 0xffffffff
  for (const byte of input) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function storedZip(entries: readonly { readonly data: string; readonly mode: number; readonly name: string }[]) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const data = Buffer.from(entry.data)
    const checksum = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    localParts.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((entry.mode << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)
    offset += local.length + name.length + data.length
  }
  const centralSize = centralParts.reduce((size, part) => size + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, ...centralParts, end])
}

for (const fileName of ['', '../escape', 'a/../escape', '/absolute', 'C:/drive', 'a\\windows']) {
  assert.throws(
    () => assertSafeZipEntry({ externalFileAttributes: 0, fileName }),
    /Unsafe ZIP entry/,
    fileName,
  )
}
assert.throws(
  () => assertSafeZipEntry({ externalFileAttributes: (0o120777 << 16) >>> 0, fileName: 'link' }),
  /symbolic links are not allowed/,
)
assert.doesNotThrow(() =>
  assertSafeZipEntry({ externalFileAttributes: (0o100644 << 16) >>> 0, fileName: 'nested/file.txt' }),
)

const root = await mkdtemp(path.join(os.tmpdir(), 'qortium-home-safe-zip-'))
try {
  const safeArchive = path.join(root, 'safe.zip')
  const safeTarget = path.join(root, 'safe-target')
  await writeFile(safeArchive, storedZip([
    { data: 'safe', mode: 0o100644, name: 'nested/file.txt' },
  ]))
  await extractZipSafely(safeArchive, { dir: safeTarget })
  assert.equal(await readFile(path.join(safeTarget, 'nested', 'file.txt'), 'utf8'), 'safe')

  const unsafeArchive = path.join(root, 'unsafe.zip')
  const unsafeTarget = path.join(root, 'unsafe-target')
  await writeFile(unsafeArchive, storedZip([
    { data: '<h1>partial</h1>', mode: 0o100644, name: 'index.html' },
    { data: '../../outside.txt', mode: 0o120777, name: 'link' },
    { data: 'overwrite', mode: 0o100644, name: 'link' },
  ]))
  await assert.rejects(extractZipSafely(unsafeArchive, { dir: unsafeTarget }), /symbolic links are not allowed/)
  await assert.rejects(lstat(unsafeTarget), /ENOENT/, 'a rejected later entry must remove earlier partial output')
  await assert.rejects(readFile(path.join(root, 'outside.txt')), /ENOENT/)

  const duplicateArchive = path.join(root, 'duplicate.zip')
  const duplicateTarget = path.join(root, 'duplicate-target')
  await writeFile(duplicateArchive, storedZip([
    { data: 'first', mode: 0o100644, name: 'same.txt' },
    { data: 'second', mode: 0o100644, name: 'same.txt' },
  ]))
  await assert.rejects(extractZipSafely(duplicateArchive, { dir: duplicateTarget }), /EEXIST/)
  await assert.rejects(lstat(duplicateTarget), /ENOENT/, 'duplicate entries must not retain the first output')
} finally {
  await rm(root, { force: true, recursive: true })
}

console.log('Safe ZIP extraction checks passed.')
