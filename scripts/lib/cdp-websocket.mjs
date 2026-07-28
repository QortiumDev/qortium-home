// Resolves a WebSocket implementation for the CDP smoke harnesses.
//
// Node exposes a global WebSocket from 22 onward. On Node 20 there is no
// global, and a smoke that assumes one dies with "WebSocket is not defined"
// after it has already built and launched the app — an expensive way to
// discover a runtime gap. Fall back to the `ws` devDependency instead; its
// addEventListener/event.data surface matches the global closely enough for
// the CDP clients here.

export async function resolveWebSocket() {
  if (typeof globalThis.WebSocket === 'function') {
    return globalThis.WebSocket;
  }

  try {
    const module = await import('ws');

    return module.default ?? module.WebSocket;
  } catch {
    throw new Error(
      'No WebSocket implementation is available. Use Node 22 or newer, or run npm install so the `ws` fallback is present.',
    );
  }
}
