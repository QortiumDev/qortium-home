const { contextBridge, ipcRenderer, webFrame } = require('electron') as typeof import('electron');

// QDN app views run with sandbox: true, where require() only resolves Electron's
// built-in shim modules — a relative require aborts the entire preload script,
// leaving window.qdnRequest undefined for every QDN app. These literals must
// stay equal to the constants in qdn-bridge-error.ts (pinned by
// qdn-bridge-error.test.ts).
const QDN_BRIDGE_ERROR_KEY = '__qdnBridgeError_9f5f01d1';
const QDN_BRIDGE_RESULT_KEY = '__qdnBridgeResult_9f5f01d1';

type QdnAppRequest = Record<string, unknown>;

let wheelAccumulator = 0;

async function sendQdnAppRequestRaw(request: QdnAppRequest) {
  return ipcRenderer.invoke('qdn-app:request', request);
}

function sendWheelCommands(event: WheelEvent) {
  // Sandboxed QDN app content can dispatch synthetic WheelEvents; only real user
  // gestures may drive host zoom / text-size commands.
  if (!event.isTrusted) {
    return;
  }

  if (!event.ctrlKey && !event.metaKey) {
    return;
  }

  event.preventDefault();

  // Shift+wheel is remapped to horizontal scroll on some platforms, so fall
  // back to deltaX when deltaY is empty.
  const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;

  if (delta === 0) {
    return;
  }

  if ((wheelAccumulator > 0 && delta < 0) || (wheelAccumulator < 0 && delta > 0)) {
    wheelAccumulator = 0;
  }

  wheelAccumulator += delta;

  // At most one step per wheel event: a single mouse notch reports a large
  // delta (typically 100), so consuming the whole accumulator here keeps one
  // notch = one step while still letting trackpads' small deltas accumulate
  // across events until they reach the threshold.
  if (Math.abs(wheelAccumulator) < 50) {
    return;
  }

  const direction = wheelAccumulator < 0 ? 'in' : 'out';

  wheelAccumulator = 0;

  ipcRenderer.send('qdn-views:wheel-command', {
    direction,
    textSize: event.shiftKey,
  });
}

window.addEventListener('wheel', sendWheelCommands, { capture: true, passive: false });

function installQdnRequest(errorKey: string, resultKey: string) {
  const rawRequest = (window as unknown as { __qdnRequestRaw: (request: unknown) => Promise<unknown> }).__qdnRequestRaw;

  Object.defineProperty(window, 'qdnRequest', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: async (request: unknown) => {
      const response = await rawRequest(request);
      const envelope = response && typeof response === 'object' && !Array.isArray(response)
        ? response as Record<string, unknown>
        : null;

      if (envelope && Object.keys(envelope).length === 1) {
        const error = envelope[errorKey];

        if (error && typeof error === 'object' && !Array.isArray(error)) {
          const payload = error as Record<string, unknown>;

          if (typeof payload.message === 'string') {
            throw Object.assign(
              new Error(payload.message),
              typeof payload.code === 'string' ? { code: payload.code } : {},
            );
          }
        }

        if (resultKey in envelope) {
          return envelope[resultKey];
        }
      }

      throw new Error('Malformed QDN bridge response.');
    },
  });
}

contextBridge.exposeInMainWorld('__qdnRequestRaw', sendQdnAppRequestRaw);

if (typeof contextBridge.executeInMainWorld === 'function') {
  contextBridge.executeInMainWorld({
    func: installQdnRequest,
    args: [QDN_BRIDGE_ERROR_KEY, QDN_BRIDGE_RESULT_KEY],
  });
} else {
  // Electron 32 (the Catalina compatibility runtime) predates
  // contextBridge.executeInMainWorld. Evaluate only this trusted, static
  // installer plus the fixed JSON-encoded envelope keys in the page world so
  // bridge errors retain their main-world Error identity and stable code.
  const source = `(${installQdnRequest.toString()})(${JSON.stringify(QDN_BRIDGE_ERROR_KEY)},${JSON.stringify(QDN_BRIDGE_RESULT_KEY)})`;
  let completed = false;
  let executionError: Error | null = null;

  void webFrame.executeJavaScript(source, false, (_result, error) => {
    completed = true;
    executionError = error ?? null;
  });

  if (!completed) {
    throw new Error('Electron 32 did not install the QDN app bridge during preload.');
  }

  if (executionError) {
    throw executionError;
  }
}
