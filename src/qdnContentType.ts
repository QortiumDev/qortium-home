// Content-type-driven QDN viewer routing.
//
// QDN routes resources by *service* (IMAGE, DOCUMENT, BLOG, ...), but the service
// is publisher-chosen and frequently wrong: an image published as DOCUMENT, audio
// as ATTACHMENT, a PDF as FILE. This module resolves the *content kind* of a
// single-file resource from the signals that actually describe its bytes — the
// publisher mimeType (weak), the filename extension, the response Content-Type
// header, and finally the leading magic bytes — so the viewer renders what the
// bytes really are.
//
// Container shape (APP/WEBSITE iframes, multi-file galleries) is decided upstream
// by service in `qdn.ts`; this module only classifies single-file content.

import type { QdnViewerKind } from './qdn';

// The subset of QdnViewerKind that can be resolved from content type alone.
export type ContentKind = Extract<
  QdnViewerKind,
  | 'archive'
  | 'audio'
  | 'code'
  | 'csv'
  | 'document'
  | 'html'
  | 'image'
  | 'json'
  | 'markdown'
  | 'text'
  | 'video'
>;

// Filename extension → content kind. Lower-case, no leading dot. The publisher
// mimeType is unreliable (often absent or application/octet-stream), so the
// extension is usually the strongest single signal we have pre-fetch.
//
// Only formats the platform can actually decode are mapped to image/audio/video —
// e.g. TIFF and Matroska (.mkv) are deliberately omitted because browsers can't
// render them, so they fall through to the download/document path instead of
// showing a broken element.
const EXTENSION_TO_KIND: Readonly<Record<string, ContentKind>> = {
  // images (browser-renderable only)
  apng: 'image',
  avif: 'image',
  bmp: 'image',
  gif: 'image',
  ico: 'image',
  jpeg: 'image',
  jpg: 'image',
  png: 'image',
  svg: 'image',
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
  // video (browser-renderable containers only)
  m4v: 'video',
  mov: 'video',
  mp4: 'video',
  ogv: 'video',
  webm: 'video',
  // general archives → file-tree browser (comics .cbz/.cbr stay 'document')
  rar: 'archive',
  zip: 'archive',
  // documents (handed to the modal DocumentViewer)
  cbr: 'document',
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
  // structured data with dedicated viewers
  csv: 'csv',
  json: 'json',
  // source code → syntax-highlighted viewer
  bash: 'code',
  c: 'code',
  cc: 'code',
  clj: 'code',
  cpp: 'code',
  cs: 'code',
  css: 'code',
  dart: 'code',
  ex: 'code',
  exs: 'code',
  go: 'code',
  gradle: 'code',
  h: 'code',
  hpp: 'code',
  ini: 'code',
  java: 'code',
  js: 'code',
  jsx: 'code',
  kt: 'code',
  less: 'code',
  lua: 'code',
  mjs: 'code',
  php: 'code',
  pl: 'code',
  py: 'code',
  r: 'code',
  rb: 'code',
  rs: 'code',
  scala: 'code',
  scss: 'code',
  sh: 'code',
  sql: 'code',
  svelte: 'code',
  swift: 'code',
  toml: 'code',
  ts: 'code',
  tsx: 'code',
  vue: 'code',
  xml: 'code',
  yaml: 'code',
  yml: 'code',
  zsh: 'code',
  // plain text → inline text viewer
  log: 'text',
  text: 'text',
  txt: 'text',
};

// Exact MIME type → content kind, for types whose `type/subtype` we recognise
// outright. Prefix matching (image/*, audio/*, video/*, text/*) is handled
// separately below.
const MIME_TO_KIND: Readonly<Record<string, ContentKind>> = {
  'application/epub+zip': 'document',
  'application/pdf': 'document',
  'application/vnd.comicbook+zip': 'document',
  'application/vnd.comicbook-rar': 'document',
  'application/x-cbr': 'document',
  'application/x-cbz': 'document',
  'application/zip': 'archive',
  'application/x-zip-compressed': 'archive',
  'application/vnd.rar': 'archive',
  'application/x-rar': 'archive',
  'application/x-rar-compressed': 'archive',
  'application/json': 'json',
  'application/xml': 'code',
  'application/xhtml+xml': 'html',
  'text/csv': 'csv',
  'text/html': 'html',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'text/xml': 'code',
};

// Exact (lower-cased) basename → content kind, for the common files that carry
// no extension yet are plainly text or source. Without this they fall through to
// the bare "download" path (e.g. a repo's LICENSE showing "can't be previewed").
const FILENAME_TO_KIND: Readonly<Record<string, ContentKind>> = {
  // licences / notices / project docs → plain text
  authors: 'text',
  changelog: 'text',
  changes: 'text',
  contributing: 'text',
  contributors: 'text',
  copying: 'text',
  copyright: 'text',
  install: 'text',
  license: 'text',
  licence: 'text',
  news: 'text',
  notice: 'text',
  readme: 'text',
  todo: 'text',
  // build / tooling files → source viewer
  brewfile: 'code',
  containerfile: 'code',
  dockerfile: 'code',
  gemfile: 'code',
  jenkinsfile: 'code',
  makefile: 'code',
  procfile: 'code',
  rakefile: 'code',
  vagrantfile: 'code',
  // common dotfiles (extensionOf treats the leading dot as the name, so these
  // never match the extension table)
  '.bashrc': 'code',
  '.editorconfig': 'code',
  '.env': 'code',
  '.gitattributes': 'text',
  '.gitignore': 'text',
  '.gitmodules': 'code',
  '.npmrc': 'code',
  '.profile': 'code',
  '.zshrc': 'code',
};

function basenameOf(filename?: string): string {
  if (!filename) {
    return '';
  }

  const clean = filename.split(/[?#]/)[0] ?? '';
  const slash = clean.lastIndexOf('/');

  return (slash >= 0 ? clean.slice(slash + 1) : clean).toLowerCase();
}

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
// determines a kind — callers fall back to magic-byte sniffing and/or
// service-based routing.
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

  const byFilename = FILENAME_TO_KIND[basenameOf(filename)];
  if (byFilename) {
    return byFilename;
  }

  const byMime = kindFromMime(normalizeMime(mimeType));
  if (byMime) {
    return byMime;
  }

  return kindFromMime(normalizeMime(responseContentType));
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) {
    return false;
  }

  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) {
      return false;
    }
  }

  return true;
}

// Last-resort classification from the leading bytes of the resource, for content
// that has no usable filename extension and an unhelpful mimeType
// (application/octet-stream or empty). Recognises the common renderable
// signatures; returns null when the bytes are not a format we display inline.
export function sniffMagicMimeType(bytes: Uint8Array): string | null {
  // Images
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(bytes, [0x42, 0x4d])) return 'image/bmp';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  // Documents
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
  // Audio
  if (startsWith(bytes, [0x49, 0x44, 0x33])) return 'audio/mpeg';
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return 'audio/ogg';
  if (startsWith(bytes, [0x66, 0x4c, 0x61, 0x43])) return 'audio/flac';
  return null;
}

export function sniffMagicBytes(bytes: Uint8Array): ContentKind | null {
  // Images
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image'; // PNG
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image'; // JPEG
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image'; // GIF8
  if (startsWith(bytes, [0x42, 0x4d])) return 'image'; // BMP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image'; // RIFF....WEBP
  }
  // Documents
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'document'; // %PDF
  // Audio
  if (startsWith(bytes, [0x49, 0x44, 0x33])) return 'audio'; // ID3 (mp3)
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return 'audio'; // OggS (treat as audio)
  if (startsWith(bytes, [0x66, 0x4c, 0x61, 0x43])) return 'audio'; // fLaC
  return null;
}
