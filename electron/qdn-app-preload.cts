const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

type QdnAppRequest = Record<string, unknown>;

let wheelAccumulator = 0;

async function sendQdnAppRequest(request: QdnAppRequest) {
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

  if (event.deltaY === 0) {
    return;
  }

  if ((wheelAccumulator > 0 && event.deltaY < 0) || (wheelAccumulator < 0 && event.deltaY > 0)) {
    wheelAccumulator = 0;
  }

  wheelAccumulator += event.deltaY;

  while (Math.abs(wheelAccumulator) >= 50) {
    const direction = wheelAccumulator < 0 ? 'in' : 'out';

    ipcRenderer.send('qdn-views:wheel-command', {
      direction,
      textSize: event.shiftKey,
    });

    wheelAccumulator += direction === 'in' ? 50 : -50;
  }
}

window.addEventListener('wheel', sendWheelCommands, { capture: true, passive: false });

contextBridge.exposeInMainWorld('qdnRequest', sendQdnAppRequest);
