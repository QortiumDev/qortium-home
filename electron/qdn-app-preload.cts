const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

type QdnAppRequest = Record<string, unknown> | string;

async function sendQdnAppRequest(request: QdnAppRequest) {
  return ipcRenderer.invoke('qdn-app:request', request);
}

function normalizeMessageRequest(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const request = data as Record<string, unknown>;

  if (request.requestedHandler !== 'UI' || typeof request.action !== 'string') {
    return null;
  }

  return request;
}

function postPortResult(port: MessagePort | undefined, result: unknown, error: unknown) {
  if (!port) {
    return;
  }

  port.postMessage({
    error,
    result,
  });
}

async function handleMessage(event: MessageEvent) {
  const request = normalizeMessageRequest(event.data);

  if (!request) {
    return;
  }

  try {
    const result = await sendQdnAppRequest(request);

    postPortResult(event.ports[0], result, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'QDN app request failed.';

    postPortResult(event.ports[0], null, {
      error: message,
      message,
    });
  }
}

contextBridge.exposeInMainWorld('qdnRequest', sendQdnAppRequest);

window.addEventListener('message', (event) => {
  void handleMessage(event);
});
