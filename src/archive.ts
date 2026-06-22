// Shared ZIP/RAR archive decoder.
//
// Both the comic reader (DocumentViewer, CBZ/CBR) and the general archive browser
// (ArchiveViewer, .zip/.rar) decode containers through this one module. The real
// container is chosen by magic bytes ("PK" → ZIP via jszip, "Rar!" → RAR via
// node-unrar-js), and both decoders are lazy-imported so neither WASM/heavy lib
// loads until an archive is actually opened.
//
// Entries expose metadata cheaply (name/size from the central directory or RAR
// header) and extract their bytes lazily through `read()`, so the browser never
// has to materialise every file in an archive up front.

export type ArchiveKind = 'zip' | 'rar';

export type ArchiveEntry = {
  /** Full internal path, e.g. "scans/cover.png". */
  path: string;
  /** Basename of the entry. */
  name: string;
  /** Whether the entry is a directory. */
  dir: boolean;
  /** Uncompressed size in bytes (0 when the backend does not report it). */
  size: number;
  /** Lazily extract this entry's bytes. */
  read: () => Promise<Uint8Array>;
};

export type OpenedArchive = {
  kind: ArchiveKind;
  entries: ArchiveEntry[];
};

/** Thrown for archives we recognise but cannot fully decode (e.g. multi-volume RAR). */
export class UnsupportedArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedArchiveError';
  }
}

function basename(path: string): string {
  const normalized = path.replace(/\/+$/, '');
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

export function sniffArchiveKind(bytes: Uint8Array): ArchiveKind | null {
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return 'zip'; // "PK"
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x72 &&
    bytes[3] === 0x21
  ) {
    return 'rar'; // "Rar!"
  }
  return null;
}

async function openZip(bytes: Uint8Array): Promise<OpenedArchive> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);

  const entries: ArchiveEntry[] = Object.keys(zip.files).map((path) => {
    const file = zip.files[path];
    // jszip exposes the uncompressed size only via the private _data field; fall
    // back to 0 if a future version drops it.
    const size = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;

    return {
      path,
      name: basename(path),
      dir: file.dir,
      size,
      read: async () => file.async('uint8array'),
    };
  });

  return { kind: 'zip', entries };
}

async function openRar(bytes: Uint8Array): Promise<OpenedArchive> {
  const { createExtractorFromData } = await import('node-unrar-js');
  const wasmBinary = await fetch(new URL('node-unrar-js/esm/js/unrar.wasm', import.meta.url)).then((response) =>
    response.arrayBuffer(),
  );
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const extractor = await createExtractorFromData({ data, wasmBinary });

  const list = extractor.getFileList();

  // The fileHeaders generator is backed by a WASM object that only frees once the
  // iterator is fully drained — always spread it, and do so BEFORE any early throw
  // (e.g. the multi-volume check below) so the archive object is never leaked.
  const headers = [...list.fileHeaders];

  if (list.arcHeader.flags.volume) {
    // node-unrar-js cannot read multi-volume RAR sets (the other parts are
    // separate resources we do not have), so surface it clearly.
    throw new UnsupportedArchiveError('multi-volume-rar');
  }

  const entries: ArchiveEntry[] = headers.map((header) => ({
    path: header.name,
    name: basename(header.name),
    dir: header.flags.directory,
    size: header.unpSize,
    read: async () => {
      if (header.flags.directory) {
        throw new Error(`Cannot read bytes from a directory entry: ${header.name}`);
      }
      // Same drain rule for the extraction generator.
      const extracted = [...extractor.extract({ files: [header.name] }).files];
      const bytesOut = extracted[0]?.extraction;
      if (!bytesOut) {
        throw new Error(`Failed to extract archive entry: ${header.name}`);
      }
      return bytesOut;
    },
  }));

  return { kind: 'rar', entries };
}

// Decode an archive from its bytes. Throws UnsupportedArchiveError for recognised
// but undecodable archives, and a generic Error if the bytes are not a ZIP/RAR.
export async function openArchive(bytes: Uint8Array): Promise<OpenedArchive> {
  const kind = sniffArchiveKind(bytes);

  if (kind === 'rar') {
    return openRar(bytes);
  }
  if (kind === 'zip') {
    return openZip(bytes);
  }

  // Unknown signature — try ZIP then RAR defensively (handles mislabeled bytes).
  try {
    return await openZip(bytes);
  } catch {
    return openRar(bytes);
  }
}
