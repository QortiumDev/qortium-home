import assert from 'node:assert/strict';
import { openEpubBook, type EpubBookLike } from './documentViewerEpub';

type TestTocItem = { href: string; label: string };
type TestBook = EpubBookLike<TestTocItem> & { destroyCalls: number };

function createBook({
  navigation = Promise.resolve({ toc: [{ href: 'chapter-1.xhtml', label: 'Chapter 1' }] }),
  opened = Promise.resolve(),
}: {
  navigation?: Promise<{ toc: TestTocItem[] }>;
  opened?: Promise<unknown>;
} = {}): TestBook {
  const book: TestBook = {
    destroy: () => { book.destroyCalls += 1; },
    destroyCalls: 0,
    loaded: { navigation },
    opened,
  };
  return book;
}

const source = new Uint8Array([99, 1, 2, 3, 88]);
const bytes = source.subarray(1, 4);
const successBook = createBook();
let epubInput: ArrayBuffer | undefined;
const success = await openEpubBook((input) => {
  epubInput = input;
  return successBook;
}, bytes);

assert.ok(epubInput instanceof ArrayBuffer);
assert.deepEqual(Array.from(new Uint8Array(epubInput)), [1, 2, 3]);
assert.equal(success.book, successBook);
assert.deepEqual(success.toc, [{ href: 'chapter-1.xhtml', label: 'Chapter 1' }]);
assert.equal(successBook.destroyCalls, 0);

const hangingBook = createBook({ navigation: new Promise(() => {}) });
await assert.rejects(
  openEpubBook(() => hangingBook, new Uint8Array([1]), { timeoutMs: 50 }),
  /Timed out while opening EPUB/,
);
assert.equal(hangingBook.destroyCalls, 1);

const rejectedBook = createBook({ opened: Promise.reject(new Error('Invalid EPUB.')) });
await assert.rejects(
  openEpubBook(() => rejectedBook, new Uint8Array([1]), { timeoutMs: 50 }),
  /Invalid EPUB/,
);
assert.equal(rejectedBook.destroyCalls, 1);

console.log('Document viewer EPUB tests passed.');
