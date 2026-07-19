export type EpubBookLike<TocItem> = {
  destroy: () => void;
  loaded: { navigation: Promise<{ toc?: TocItem[] }> };
  opened: Promise<unknown>;
};

export type EpubFactory<Book> = (input: ArrayBuffer) => Book;

export type OpenEpubBookOptions = {
  timeoutMs?: number;
};

const DEFAULT_OPEN_TIMEOUT_MS = 20_000;

/**
 * Opens an EPUB from its binary data and waits for its navigation to load.
 * epub.js detects ArrayBuffer input as a packed EPUB; blob URLs have no file
 * extension and are instead treated as unpacked-book directories.
 */
export async function openEpubBook<TocItem, Book extends EpubBookLike<TocItem>>(
  ePub: EpubFactory<Book>,
  bytes: Uint8Array,
  { timeoutMs = DEFAULT_OPEN_TIMEOUT_MS }: OpenEpubBookOptions = {},
): Promise<{ book: Book; toc: TocItem[] }> {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const book = ePub(input);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const loading = Promise.all([book.opened, book.loaded.navigation]);
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Timed out while opening EPUB.')), timeoutMs);
    });
    const [, navigation] = await Promise.race([loading, timeout]);
    return { book, toc: navigation.toc ?? [] };
  } catch (error) {
    book.destroy();
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
