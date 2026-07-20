// Keep Git parsing behind one lazy renderer chunk. Re-exporting only the read
// APIs lets Vite remove isomorphic-git's network and write operations.
// isomorphic-git's browser bundle expects the conventional Buffer global that
// webpack used to inject automatically; Vite deliberately does not. Install it
// only when this lazy chunk loads.
import { Buffer as BrowserBuffer } from 'buffer';

const browserGlobal = globalThis as typeof globalThis & { Buffer?: typeof BrowserBuffer };
browserGlobal.Buffer ??= BrowserBuffer;

export { currentBranch, listBranches, listFiles, log, readBlob } from 'isomorphic-git';
