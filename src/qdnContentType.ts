// Content-type-driven QDN viewer routing.
//
// QDN routes resources by *service* (IMAGE, DOCUMENT, BLOG, ...), but the service
// is publisher-chosen and frequently wrong: an image published as DOCUMENT, audio
// as ATTACHMENT, a PDF as FILE. This module resolves the *content kind* of a
// single-file resource from the signals that actually describe its bytes — the
// publisher mimeType (weak), the filename extension, and (post-fetch) the response
// Content-Type header — so the viewer renders what the bytes really are.
//
// Container shape (APP/WEBSITE iframes, multi-file galleries) is decided upstream
// by service in `qdn.ts`; this module only classifies single-file content.

import type { QdnViewerKind } from './qdn';

// The subset of QdnViewerKind that can be resolved from content type alone.
export type ContentKind = Extract<
  QdnViewerKind,
  'audio' | 'document' | 'html' | 'image' | 'markdown' | 'text' | 'video'
>;

// Filename extension → content kind. Lower-case, no leading dot. The publisher
// mimeType is unreliable (often absent or application/octet-stream), so the
// extension is usually the strongest single signal we have pre-fetch.
const EXTENSION_TO_KIND: Readonly<Record<string, ContentKind>> = {
  // images
  apng: 'image',
  avif: 'image',
  bmp: 'image',
  gif: 'image',
  ico: 'image',
  jpeg: 'image',
  jpg: 'image',
  png: 'image',
  svg: 'image',
  tif: 'image',
  tiff: 'image',
  webp: 'image',
  // audio
  aac: 'audio',
  flac: 'audio',
  m4a: 'audio',
  mp3: 'audio',
  oga: 'audio',
  ogg: 'audio',
  opus: 'audio',
  wav: 'audio',
  weba: 'audio',
  // video
  m4v: 'video',
  mkv: 'video',
  mov: 'video',
  mp4: 'video',
  ogv: 'video',
  webm: 'video',
  // documents (handed to the modal DocumentViewer)
  cbz: 'document',
  epub: 'document',
  pdf: 'document',
  // rich text rendered in a locked-down sandboxed iframe
  htm: 'html',
  html: 'html',
  markdown: 'markdown',
  md: 'markdown',
  mdown: 'markdown',
  mkd: 'markdown',
  // plain text / data → inline text viewer (which already pretty-prints JSON)
  csv: 'text',
  json: 'text',
  log: 'text',
  text: 'text',
  txt: 'text',
  xml: 'text',
  yaml: 'text',
  yml: 'text',
};

// Exact MIME type → content kind, for types whose `type/subtype` we recognise
// outright. Prefix matching (image/*, audio/*, video/*, text/*) is handled
// separately below.
const MIME_TO_KIND: Readonly<Record<string, ContentKind>> = {
  'application/epub+zip': 'document',
  'application/pdf': 'document',
  'application/vnd.comicbook+zip': 'document',
  'application/x-cbz': 'document',
  'application/json': 'text',
  'application/xml': 'text',
  'application/xhtml+xml': 'html',
  'text/html': 'html',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
};

function extensionOf(filename?: string): string {
  if (!filename) {
    return '';
  }

  const clean = filename.split(/[?#]/)[0] ?? '';
  const dot = clean.lastIndexOf('.');

  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
}

function normalizeMime(value?: string): string {
  // Strip parameters (e.g. "text/html; charset=utf-8") and lower-case.
  return (value ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function kindFromMime(mime: string): ContentKind | null {
  if (!mime || mime === 'application/octet-stream') {
    return null;
  }

  const exact = MIME_TO_KIND[mime];
  if (exact) {
    return exact;
  }

  if (mime.startsWith('image/')) {
    return 'image';
  }
  if (mime.startsWith('audio/')) {
    return 'audio';
  }
  if (mime.startsWith('video/')) {
    return 'video';
  }
  if (mime.startsWith('text/')) {
    return 'text';
  }

  return null;
}

// Resolve a single-file resource's content kind from its descriptive signals, in
// priority order: filename extension → publisher mimeType → response Content-Type.
//
// The extension is checked first because it is the most reliable publisher-set
// signal in practice; mimeType and the response header are honoured next so a
// resource with no/strange extension still resolves. Returns null when nothing
// determines a kind — callers fall back to service-based routing.
export function detectContentKind(
  filename?: string,
  mimeType?: string,
  responseContentType?: string,
): ContentKind | null {
  const ext = extensionOf(filename);
  const byExtension = ext ? EXTENSION_TO_KIND[ext] : undefined;
  if (byExtension) {
    return byExtension;
  }

  const byMime = kindFromMime(normalizeMime(mimeType));
  if (byMime) {
    return byMime;
  }

  return kindFromMime(normalizeMime(responseContentType));
}
