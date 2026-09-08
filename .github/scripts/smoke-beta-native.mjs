import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { Cdp } = await import(pathToFileURL(path.resolve('scripts/lib/home-v2-cdp.mjs')));
const binary = path.resolve(process.argv[2]);
const profile = mkdtempSync(path.join(os.tmpdir(), 'home-beta-native-'));
const port = 9842;
const child = spawn(binary, [`--remote-debugging-port=${port}`], {
  env: { ...process.env, QORTIUM_HOME_USER_DATA_DIR: profile },
  stdio: 'ignore',
});
let cdp;
try {
  const deadline = Date.now() + 90_000;
  while (!cdp && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = targets.find(item => item.url.includes('v2-live.html'));
      if (target) {
        cdp = new Cdp(target.webSocketDebuggerUrl);
        await cdp.ready;
      }
    } catch {}
  }
  assert.ok(cdp, 'Packaged Home 2 renderer must open');
  let state;
  while (Date.now() < deadline) {
    state = await cdp.evaluate(`({ tabs: !!document.querySelector('.home-v2-tabs'), text: document.body?.innerText.slice(0, 3000) ?? '' })`);
    if (state.tabs) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(state?.tabs, 'Packaged shell must render its tab strip');
  await cdp.send('Page.enable');
  const screenshot = await cdp.send('Page.captureScreenshot', {format: 'png'});
  mkdirSync('native-artifacts', {recursive: true});
  writeFileSync('native-artifacts/native-shell.png', screenshot.data, 'base64');
  writeFileSync('native-artifacts/native-shell.json', JSON.stringify({platform: process.platform, arch: process.arch, ...state}, null, 2));
  console.log('Native packaged Home shell PASS');
} finally {
  cdp?.socket.close();
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {stdio: 'ignore'});
  } else {
    child.kill('SIGTERM');
  }
}
