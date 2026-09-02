// A minimal STREAMING zip writer, used to package a folder publish source.
//
// Why not fflate's zipSync, which the rest of Home already depends on: it
// takes a map of whole files in memory and does every deflate on the calling
// thread. Packaging a folder that way means the uncompressed tree, the
// compressed archive and the JS deflate work all land in Electron's main
// process at once, which is exactly the freeze this module exists to avoid.
//
// What this does instead: entries are appended one at a time, each file's
// bytes flow source -> crc/size counter -> zlib.createDeflateRaw -> the
// destination file handle, with stream backpressure throttling the read. Node's
// zlib does the compression on the libuv thread pool, so the main thread does
// bookkeeping only, and nothing larger than a stream chunk is resident.
//
// The output is an ordinary deflate zip with no zip64 records, no data
// descriptors and no directory entries: fflate's unzipSync (which
// qdn-content-attestation runs over the very archive this writes) and Core's
// unpacker both read it. Sizes are unknown until an entry has been compressed,
// so the local header is written with placeholders and patched in place
// afterwards through a positional write — possible here, and not in a pipe,
// because the destination is a Home-owned temp FILE.
import { createHash } from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createDeflateRaw, crc32 as nodeCrc32 } from 'node:zlib'

const LOCAL_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const VERSION_NEEDED = 20
const FLAG_UTF8_NAMES = 0x0800
const METHOD_DEFLATE = 8
// A fixed 1980-01-01 timestamp rather than the file's own mtime: the archive
// is content Home attests byte-for-byte, and the modification times of the
// user's private files are not something a publish needs to carry.
const DOS_TIME = 0
const DOS_DATE = 0x0021
// 4 GiB - 1. Everything this writer packages is bounded far below it by the
// publish ceilings, so a zip64 record can never be needed; the check exists so
// a future ceiling change fails loudly instead of writing a corrupt archive.
const MAX_UINT32 = 0xffffffff

const CRC32_TABLE = (() => {
  const table = new Int32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value
  }
  return table
})()

/**
 * CRC-32 (the zip polynomial). Node's native implementation is used when it is
 * available (Node 20.15+), because it runs at memcpy speed rather than a byte
 * at a time on the main thread; the table fallback keeps this module correct
 * on any runtime that predates it.
 */
export function homeV2Crc32(bytes: Uint8Array, seed = 0) {
  if (typeof nodeCrc32 === 'function') return nodeCrc32(bytes, seed) >>> 0
  let crc = ~seed
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  }
  return ~crc >>> 0
}

type ZipEntryRecord = {
  readonly compressedSize: number
  readonly crc: number
  readonly nameBytes: Buffer
  readonly offset: number
  readonly uncompressedSize: number
}

export type HomeV2ZipEntryResult = Readonly<{
  compressedSize: number
  uncompressedSize: number
}>

export class HomeV2PublishZipLimitError extends Error {}

/**
 * Appends deflate entries to an open file handle.
 *
 * `maximumArchiveBytes` is enforced AS THE ARCHIVE IS WRITTEN, not after: a
 * source that compresses worse than expected stops mid-entry with a
 * HomeV2PublishZipLimitError instead of filling the disk first and being
 * measured afterwards.
 */
export class HomeV2PublishZipWriter {
  #entries: ZipEntryRecord[] = []
  #finished = false
  #offset = 0

  constructor(
    private readonly handle: FileHandle,
    private readonly maximumArchiveBytes: number,
    private readonly deflateLevel = 6,
  ) {}

  get archiveBytes() {
    return this.#offset
  }

  get entryCount() {
    return this.#entries.length
  }

  async #write(bytes: Uint8Array) {
    if (this.#offset + bytes.byteLength > this.maximumArchiveBytes) {
      throw new HomeV2PublishZipLimitError('Packaged publish source exceeded the archive size limit.')
    }
    const { bytesWritten } = await this.handle.write(bytes, 0, bytes.byteLength, this.#offset)
    if (bytesWritten !== bytes.byteLength) {
      throw new Error('Short write while packaging the publish source.')
    }
    this.#offset += bytesWritten
  }

  /**
   * Append one file. `name` must already be the canonical, forward-slashed zip
   * path; this writer does not sanitize it, because the walker that produced
   * it is the only place that can decide what a rejected name means.
   */
  async addFile(name: string, source: AsyncIterable<Uint8Array> | NodeJS.ReadableStream) {
    if (this.#finished) throw new Error('The publish archive is already finished.')
    const nameBytes = Buffer.from(name, 'utf8')
    const offset = this.#offset
    const header = Buffer.alloc(30 + nameBytes.byteLength)
    header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0)
    header.writeUInt16LE(VERSION_NEEDED, 4)
    header.writeUInt16LE(FLAG_UTF8_NAMES, 6)
    header.writeUInt16LE(METHOD_DEFLATE, 8)
    header.writeUInt16LE(DOS_TIME, 10)
    header.writeUInt16LE(DOS_DATE, 12)
    // crc32, compressed size and uncompressed size are patched below.
    header.writeUInt16LE(nameBytes.byteLength, 26)
    header.writeUInt16LE(0, 28)
    nameBytes.copy(header, 30)
    await this.#write(header)

    let crc = 0
    let uncompressedSize = 0
    const dataOffset = this.#offset
    const counter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        crc = homeV2Crc32(chunk, crc)
        uncompressedSize += chunk.byteLength
        callback(null, chunk)
      },
    })
    const sink = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        this.#write(chunk).then(() => callback(), callback)
      },
    })
    await pipeline(source, counter, createDeflateRaw({ level: this.deflateLevel }), sink)
    const compressedSize = this.#offset - dataOffset
    if (uncompressedSize > MAX_UINT32 || compressedSize > MAX_UINT32) {
      throw new HomeV2PublishZipLimitError('Packaged publish source entry is too large for a zip archive.')
    }

    const patch = Buffer.alloc(12)
    patch.writeUInt32LE(crc, 0)
    patch.writeUInt32LE(compressedSize, 4)
    patch.writeUInt32LE(uncompressedSize, 8)
    // Checked like every other write here: a short write would leave the local
    // header claiming a zero crc or a zero size, which is a corrupt archive
    // that only fails at whoever unpacks it.
    const patched = await this.handle.write(patch, 0, patch.byteLength, offset + 14)
    if (patched.bytesWritten !== patch.byteLength) {
      throw new Error('Short write while packaging the publish source.')
    }

    this.#entries.push({ compressedSize, crc, nameBytes, offset, uncompressedSize })
    return Object.freeze({ compressedSize, uncompressedSize }) as HomeV2ZipEntryResult
  }

  /** Write the central directory and return the archive's total byte length. */
  async finish() {
    if (this.#finished) throw new Error('The publish archive is already finished.')
    this.#finished = true
    if (this.#entries.length > 0xffff) {
      throw new HomeV2PublishZipLimitError('Packaged publish source holds more entries than a zip archive can index.')
    }
    const centralDirectoryOffset = this.#offset
    for (const entry of this.#entries) {
      const record = Buffer.alloc(46 + entry.nameBytes.byteLength)
      record.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0)
      record.writeUInt16LE(VERSION_NEEDED, 4)
      record.writeUInt16LE(VERSION_NEEDED, 6)
      record.writeUInt16LE(FLAG_UTF8_NAMES, 8)
      record.writeUInt16LE(METHOD_DEFLATE, 10)
      record.writeUInt16LE(DOS_TIME, 12)
      record.writeUInt16LE(DOS_DATE, 14)
      record.writeUInt32LE(entry.crc, 16)
      record.writeUInt32LE(entry.compressedSize, 20)
      record.writeUInt32LE(entry.uncompressedSize, 24)
      record.writeUInt16LE(entry.nameBytes.byteLength, 28)
      if (entry.offset > MAX_UINT32) {
        throw new HomeV2PublishZipLimitError('Packaged publish source is too large for a zip archive.')
      }
      record.writeUInt32LE(entry.offset, 42)
      entry.nameBytes.copy(record, 46)
      await this.#write(record)
    }
    const end = Buffer.alloc(22)
    end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0)
    end.writeUInt16LE(this.#entries.length, 8)
    end.writeUInt16LE(this.#entries.length, 10)
    end.writeUInt32LE(this.#offset - centralDirectoryOffset, 12)
    end.writeUInt32LE(centralDirectoryOffset, 16)
    await this.#write(end)
    return this.#offset
  }
}

/** SHA-256 hex of a file, streamed rather than buffered. */
export async function sha256HexOfStream(source: AsyncIterable<Uint8Array> | NodeJS.ReadableStream) {
  const hash = createHash('sha256')
  for await (const chunk of source as AsyncIterable<Uint8Array>) hash.update(chunk)
  return hash.digest('hex')
}
