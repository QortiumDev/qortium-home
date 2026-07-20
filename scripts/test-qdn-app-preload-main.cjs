// Electron main fixture for test-qdn-app-preload.mjs. Loads the REAL built
// QDN app preload into a sandboxed BrowserWindow (the same webPreferences as
// electron/qdn-views.ts) and exercises window.qdnRequest against a stub
// 'qdn-app:request' handler that uses the real bridge envelope encoders.
//
// This exists because a sandboxed preload's require() cannot load relative
// modules: one bad require aborts the whole preload and silently strips
// window.qdnRequest from every QDN app (the Home 1.5.0 chat regression).
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const distElectron = path.join(__dirname, '..', 'dist-electron');
const preload = path.join(distElectron, 'qdn-app-preload.cjs');
let preloadError = null;

app.whenReady().then(async () => {
  const { encodeQdnBridgeError, encodeQdnBridgeResult } = await import(
    pathToFileURL(path.join(distElectron, 'qdn-bridge-error.js')).href
  );
  const expectedElectronVersion = process.env.QORTIUM_HOME_EXPECTED_ELECTRON_VERSION;

  if (expectedElectronVersion && process.versions.electron !== expectedElectronVersion) {
    throw new Error(
      `Expected Electron ${expectedElectronVersion}, received ${process.versions.electron}`,
    );
  }

  ipcMain.handle('qdn-app:request', async (_event, request) => {
    try {
      const action = request && typeof request === 'object' ? request.action : undefined;

      switch (action) {
        case 'TEST_RESULT':
          return encodeQdnBridgeResult({ address: 'QTestAddress123', name: 'tester' });
        case 'TEST_UNDEFINED_RESULT':
          return encodeQdnBridgeResult(undefined);
        case 'TEST_ERROR':
          throw Object.assign(new Error('Account request was denied'), { code: 'ACCOUNT_DENIED' });
        case 'TEST_MALFORMED_RESULT':
          return { unexpected: true };
        default:
          throw new Error(`Unexpected test action: ${String(action)}`);
      }
    } catch (error) {
      return encodeQdnBridgeError(error);
    }
  });

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    preloadError = `${preloadPath}: ${error.message}`;
  });

  const html = `<!doctype html>
    <meta http-equiv="Content-Security-Policy" content="script-src 'nonce-qdn-preload-test'">
    <script nonce="qdn-preload-test">
      window.__qdnRequestAtFirstParserScript = typeof window.qdnRequest;
    </script>
    <body>qdn-app-preload-test</body>`;
  const fixtureUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

  await win.loadURL(fixtureUrl);

  if (preloadError) {
    console.error(`[qdn-app-preload-test] FAIL preload-error ${preloadError}`);
    app.exit(1);
    return;
  }

  const outcome = await win.webContents.executeJavaScript(`(async () => {
    if (window.__qdnRequestAtFirstParserScript !== 'function') {
      return { failure: 'qdnRequest was not ready for the first parser script: ' + window.__qdnRequestAtFirstParserScript };
    }

    if (typeof window.qdnRequest !== 'function') {
      return { failure: 'window.qdnRequest is not a function: ' + typeof window.qdnRequest };
    }

    const descriptor = Object.getOwnPropertyDescriptor(window, 'qdnRequest');
    if (!descriptor || descriptor.configurable || !descriptor.enumerable || descriptor.writable) {
      return { failure: 'qdnRequest property descriptor is not locked: ' + JSON.stringify(descriptor) };
    }

    const result = await window.qdnRequest({ action: 'TEST_RESULT' });
    if (!result || result.address !== 'QTestAddress123' || result.name !== 'tester') {
      return { failure: 'result envelope did not unwrap: ' + JSON.stringify(result) };
    }

    const undefinedResult = await window.qdnRequest({ action: 'TEST_UNDEFINED_RESULT' });
    if (undefinedResult !== undefined) {
      return { failure: 'undefined result did not survive: ' + String(undefinedResult) };
    }

    try {
      await window.qdnRequest({ action: 'TEST_ERROR' });
      return { failure: 'error envelope did not throw' };
    } catch (error) {
      if (!(error instanceof Error)) {
        return { failure: 'error envelope did not create a main-world Error' };
      }

      if (error.message !== 'Account request was denied' || error.code !== 'ACCOUNT_DENIED') {
        return { failure: 'error envelope lost message/code: ' + error.message + ' / ' + error.code };
      }
    }

    try {
      await window.qdnRequest({ action: 'TEST_MALFORMED_RESULT' });
      return { failure: 'malformed envelope did not throw' };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'Malformed QDN bridge response.') {
        return { failure: 'malformed envelope lost main-world error behavior: ' + String(error) };
      }
    }

    return { failure: null };
  })()`);

  if (outcome && outcome.failure) {
    console.error(`[qdn-app-preload-test] FAIL ${outcome.failure}`);
    app.exit(1);
    return;
  }

  console.log(
    `[qdn-app-preload-test] PASS qdnRequest works in a sandboxed QDN app view on Electron ${process.versions.electron}`,
  );
  app.exit(0);
}).catch((error) => {
  console.error(`[qdn-app-preload-test] FAIL ${error instanceof Error ? error.stack : String(error)}`);
  app.exit(1);
});
