import { createReadStream } from 'node:fs'
import { opendir } from 'node:fs/promises'
import nodePath from 'node:path'
import { Zip, ZipDeflate } from 'fflate'

import {
  HOME_V2_PREVIEW_TOO_LARGE,
  HOME_V2_PREVIEW_UNSUPPORTED_CONTENT,
  HOME_V2_PREVIEW_UPLOAD_MAX_BYTES,
} from './home-v2-preview-upload.js'
import { homeV2PublishSourceError } from './home-v2-publish-source-selection.js'

// Raised as a publish-source error so it passes through the preview handler's
// scrubber intact: those messages are the fixed, path-free sentences an APP is
// allowed to see, and everything else is replaced with a generic one.
const tooLarge = () => homeV2PublishSourceError(HOME_V2_PREVIEW_TOO_LARGE)

/**
 * Pack an already-STAGED preview tree into a zip for Core's byte-upload
 * preview route.
 *
 * The input is always a Home-owned staging directory built by
 * `stageHomeV2PublishSourceForPreview` (or by qdn.ts's zip extractor / HTML
 * wrapper), so every entry has already been walked with the directory caps,
 * symlinks have already been materialised or refused, and nothing here has to
 * re-litigate what is safe to read. What this adds is the WIRE bound: the zip
 * is produced incrementally and abandoned the moment it passes
 * HOME_V2_PREVIEW_UPLOAD_MAX_BYTES, so a large staged tree is refused with a
 * fixed, path-free sentence instead of being buffered whole.
 *
 * Deflate runs SYNCHRONOUSLY, one read-stream chunk at a time. fflate's async
 * variant compresses on a worker thread, which sounds better here and is not:
 * inside the Electron main process that worker never delivered its output and
 * the preview hung forever (caught by the desktop smoke, 2026-09-02). Chunked
 * synchronous deflate costs well under a millisecond per 64 KiB chunk and the
 * file read yields between chunks, so the main process is never held for long.
 */
async function* walkPreviewTree(root: string, current: string): AsyncGenerator<{
  absolute: string
  relative: string
}> {
  const directory = await opendir(current)
  for await (const entry of directory) {
    const absolute = nodePath.join(current, entry.name)
    if (entry.isDirectory()) {
      yield* walkPreviewTree(root, absolute)
      continue
    }
    // The staged tree holds regular files only (the stager materialises
    // contained links and refuses devices, FIFOs and sockets), so anything
    // else here is skipped rather than read.
    if (!entry.isFile()) continue
    yield {
      absolute,
      relative: nodePath.relative(root, absolute).split(nodePath.sep).join('/'),
    }
  }
}

export async function zipHomeV2PreviewDirectory(
  root: string,
  maximumBytes: number = HOME_V2_PREVIEW_UPLOAD_MAX_BYTES,
): Promise<Uint8Array> {
  const entries: { absolute: string; relative: string }[] = []
  for await (const entry of walkPreviewTree(root, root)) entries.push(entry)
  // Nothing to render. Refused here rather than uploading a zero-entry archive
  // for Core to fail on.
  if (entries.length === 0) throw homeV2PublishSourceError(HOME_V2_PREVIEW_UNSUPPORTED_CONTENT)
  // Deterministic member order: the same folder must produce the same archive,
  // so the preview hash Core returns is stable across runs.
  entries.sort((left, right) => (left.relative < right.relative ? -1 : left.relative > right.relative ? 1 : 0))

  const chunks: Uint8Array[] = []
  let total = 0
  let overflow = false
  let failure: Error | null = null
  let settle: (() => void) | null = null
  const finished = new Promise<void>((resolve) => {
    settle = resolve
  })
  let done = false
  const finish = () => {
    if (done) return
    done = true
    settle?.()
  }

  const zip = new Zip((error, data, final) => {
    if (error) {
      failure ??= error instanceof Error ? error : new Error(String(error))
      finish()
      return
    }
    if (overflow || failure) return
    total += data.length
    if (total > maximumBytes) {
      overflow = true
      failure ??= tooLarge()
      finish()
      return
    }
    chunks.push(data)
    if (final) finish()
  })

  try {
    for (const entry of entries) {
      if (overflow || failure) break
      const member = new ZipDeflate(entry.relative, { level: 6 })
      zip.add(member)
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(entry.absolute)
        stream.on('data', (chunk) => {
          if (overflow || failure) {
            stream.destroy()
            return
          }
          member.push(
            typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk),
            false,
          )
        })
        stream.on('error', reject)
        stream.on('close', () => {
          if (overflow || failure) {
            resolve()
            return
          }
          try {
            member.push(new Uint8Array(0), true)
            resolve()
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)))
          }
        })
      })
    }
    if (!overflow && !failure) zip.end()
    await finished
  } finally {
    if (failure || overflow || !done) {
      // An overflow or a read error abandons the stream mid-flight; terminate
      // the compression workers rather than leaving them alive for the rest of
      // the process's life. After a clean end fflate has already ended them.
      try {
        zip.terminate()
      } catch {
        // Already ended.
      }
    }
  }

  if (failure) throw failure
  const packed = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    packed.set(chunk, offset)
    offset += chunk.length
  }
  return packed
}
