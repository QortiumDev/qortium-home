import { HOME_V2_PUBLISH_SOURCE_MAX_BYTES } from './home-v2-publish-source-tokens.js'

/**
 * The BYTE-UPLOAD preview contract, shared by both hosts.
 *
 * Core exposes two preview routes. `POST /arbitrary/preview/{service}` takes a
 * LOCAL FILESYSTEM PATH, which only ever worked because Home and the node
 * happened to be the same machine — a node on the user's own VPS cannot read
 * Home's disk, so that route silently made "preview" a loopback-only feature
 * and the loopback gate in front of it looked like a security rule rather than
 * the transport limitation it actually was (2026-09-02 owner decision: gate on
 * TRUST, never on the node being local).
 *
 * `POST /arbitrary/preview/{service}/upload?filename=&archive=` takes the
 * BYTES instead, so it works against any node the user is trusted on. Home 2
 * uses it EXCLUSIVELY — desktop and Android, loopback and remote alike. The
 * path route is not kept as a loopback optimisation on purpose: one transport
 * means one set of behaviour to test, and it is the desktop smoke test (which
 * runs against a loopback node) that then exercises the same code a VPS user
 * gets.
 *
 * This module is pure so both the Electron main process and the Android
 * renderer can share it; neither the key nor the bytes pass through here.
 */

/**
 * Extension -> service, for a single uploaded FILE. Mirrors the 1.x Android
 * table and `QDN_PREVIEW_EXTENSION_SERVICES` in electron/qdn.ts; kept here so
 * the renderer, which cannot import the main-process QDN module, resolves the
 * same service the desktop stager would.
 */
export const HOME_V2_PREVIEW_EXTENSION_SERVICES: ReadonlyMap<string, string> = new Map([
  ['apng', 'IMAGE'],
  ['avif', 'IMAGE'],
  ['bmp', 'IMAGE'],
  ['gif', 'IMAGE'],
  ['ico', 'IMAGE'],
  ['jpeg', 'IMAGE'],
  ['jpg', 'IMAGE'],
  ['png', 'IMAGE'],
  ['svg', 'IMAGE'],
  ['webp', 'IMAGE'],
  ['m4v', 'VIDEO'],
  ['mkv', 'VIDEO'],
  ['mov', 'VIDEO'],
  ['mp4', 'VIDEO'],
  ['ogv', 'VIDEO'],
  ['webm', 'VIDEO'],
  ['aac', 'AUDIO'],
  ['flac', 'AUDIO'],
  ['m4a', 'AUDIO'],
  ['mp3', 'AUDIO'],
  ['oga', 'AUDIO'],
  ['ogg', 'AUDIO'],
  ['opus', 'AUDIO'],
  ['wav', 'AUDIO'],
])

/**
 * The wire ceiling for one preview upload, in DECODED bytes.
 *
 * The same 100 MiB cap the publish-source picker already enforces. A folder
 * selection may legitimately walk up to HOME_V2_PUBLISH_DIRECTORY_MAX_BYTES on
 * disk, but what leaves the machine is the zip, and an upload transport has to
 * bound what it buffers: everything above this is refused with a path-free
 * message rather than being read into memory first.
 */
export const HOME_V2_PREVIEW_UPLOAD_MAX_BYTES = HOME_V2_PUBLISH_SOURCE_MAX_BYTES

/** Base64 expands 3 bytes to 4, plus padding. */
export const HOME_V2_PREVIEW_UPLOAD_MAX_BASE64_LENGTH =
  Math.ceil(HOME_V2_PREVIEW_UPLOAD_MAX_BYTES / 3) * 4 + 16

export const HOME_V2_PREVIEW_UNSUPPORTED_CONTENT =
  'Unsupported preview content. Choose a folder or zip containing an index.html file, an HTML file, or an image, video, or audio file.'

export const HOME_V2_PREVIEW_TOO_LARGE =
  'The selected source is too large to preview. Previews are limited to 100 MiB of content.'

export const HOME_V2_PREVIEW_UNEXPECTED_URL = 'The node returned an unexpected preview URL.'

export type HomeV2PreviewUploadTarget = Readonly<{
  /** true when the body is a ZIP of a directory, which Core extracts. */
  archive: boolean
  /** Echoed to Core so a single file keeps its extension (and HTML is wrapped). */
  filename: string
  service: string
}>

function previewExtension(fileName: string) {
  const base = fileName.split(/[\\/]/).pop() ?? ''
  return base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : ''
}

/**
 * The upload target for a single FILE the user picked.
 *
 * `.zip` is declared as an archive so Core extracts it (the desktop host never
 * reaches this branch — it extracts and re-packs the tree itself, so the
 * staged copy is what gets uploaded rather than the user's own archive — but
 * Android has only the bytes, which is exactly the case Core's `archive=true`
 * exists for). `.html` uploads as a single file: Core wraps an HTML upload to
 * the WEBSITE service as index.html by itself.
 */
export function resolveHomeV2PreviewUploadForFile(fileName: string): HomeV2PreviewUploadTarget {
  const name = (fileName || '').split(/[\\/]/).pop()?.slice(0, 180) || 'qdn-resource'
  const extension = previewExtension(name)
  if (extension === 'zip') return Object.freeze({ archive: true, filename: name, service: 'WEBSITE' })
  if (extension === 'html' || extension === 'htm') {
    return Object.freeze({ archive: false, filename: name, service: 'WEBSITE' })
  }
  const service = HOME_V2_PREVIEW_EXTENSION_SERVICES.get(extension)
  if (!service) throw new Error(HOME_V2_PREVIEW_UNSUPPORTED_CONTENT)
  return Object.freeze({ archive: false, filename: name, service })
}

/** The request path for a preview upload, query included. */
export function homeV2PreviewUploadPath(target: HomeV2PreviewUploadTarget) {
  if (!/^[A-Z_]{1,40}$/.test(target.service)) throw new Error(HOME_V2_PREVIEW_UNSUPPORTED_CONTENT)
  const query = new URLSearchParams({
    archive: target.archive ? 'true' : 'false',
    filename: target.filename,
  })
  return `/arbitrary/preview/${encodeURIComponent(target.service)}/upload?${query.toString()}`
}

/**
 * Core answers with a `/render/hash/<hash>` path and nothing else. Anything
 * that is not a bare, same-origin-relative render path is refused: the answer
 * becomes a tab URL, so a node that replied with an absolute URL or a
 * protocol-relative `//host/...` would be choosing the host Home navigates to.
 */
export function isHomeV2PreviewRenderPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/render/') &&
    !value.startsWith('//') &&
    value.length <= 512 &&
    !/[\s<>"'\\]/.test(value)
  )
}
