import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import JSZip from 'jszip';

const require = createRequire(import.meta.url);
const epubModule = require('epubjs');
const epubCore = require('epubjs/lib/utils/core');
const ePub = epubModule.default;

globalThis.window ??= {
  URL: globalThis.URL,
  decodeURIComponent: globalThis.decodeURIComponent,
};

const parsed = epubCore.parse(
  '<?xml version="1.0"?><package><metadata><title>Fallback parser</title></metadata></package>',
  'application/xml',
  true,
);

assert.equal(parsed.documentElement.nodeName, 'package');
assert.equal(parsed.getElementsByTagName('title')[0]?.textContent, 'Fallback parser');

const zip = new JSZip();
zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
zip.file(
  'META-INF/container.xml',
  `<?xml version="1.0"?>
  <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles>
      <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
    </rootfiles>
  </container>`,
);
zip.file(
  'OEBPS/content.opf',
  `<?xml version="1.0"?>
  <package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:identifier id="book-id">qortium-home-epub-test</dc:identifier>
      <dc:title>Qortium EPUB override test</dc:title>
      <dc:language>en</dc:language>
    </metadata>
    <manifest>
      <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
      <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" />
    </manifest>
    <spine>
      <itemref idref="chapter" />
    </spine>
  </package>`,
);
zip.file(
  'OEBPS/nav.xhtml',
  `<?xml version="1.0" encoding="UTF-8"?>
  <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
    <head><title>Contents</title></head>
    <body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Chapter</a></li></ol></nav></body>
  </html>`,
);
zip.file(
  'OEBPS/chapter.xhtml',
  `<?xml version="1.0" encoding="UTF-8"?>
  <html xmlns="http://www.w3.org/1999/xhtml">
    <head><title>Chapter</title></head>
    <body><h1>Override compatibility</h1><p>Qortium Home EPUB test.</p></body>
  </html>`,
);

const archive = await zip.generateAsync({ type: 'arraybuffer' });
const book = ePub();

try {
  await book.open(archive);
  await Promise.all([book.loaded.metadata, book.loaded.spine, book.loaded.navigation]);
  assert.equal(book.package?.metadata?.title, 'Qortium EPUB override test');
  assert.equal(book.spine?.length, 1);
  assert.ok(Array.isArray(book.navigation?.toc));

  const section = book.spine.get(0);
  const chapter = await section.load(book.load.bind(book));
  assert.equal(chapter.getElementsByTagName('h1')[0]?.textContent, 'Override compatibility');
} finally {
  book.destroy();
}

console.log('EPUB.js xmldom override compatibility test passed.');
