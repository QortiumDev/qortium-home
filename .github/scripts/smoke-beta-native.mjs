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
  // Rosetta x64 first launches on the arm64 runner took ~85 s to open the renderer
  // during beta.2 acceptance, leaving no time for shell initialization.
  const deadline = Date.now() + 300_000;
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
  console.log('Packaged document', await cdp.evaluate('location.href'));
  const coreExpression = `(async () => ({
    qortium: await window.homeV2CoreManagers.getStatus('qortium'),
    qortal: await window.homeV2CoreManagers.getStatus('qortal'),
    adoption: await window.homeV2CoreManagers.listQortalAdoptionCandidates(),
  }))()`;
  let core;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      core = await cdp.evaluate(coreExpression);
      break;
    } catch (error) {
      console.log('Bridge readiness attempt', attempt + 1, String(error));
      if (attempt === 4) {
        console.log('Packaged shell state', await cdp.evaluate('document.body.innerText.slice(0, 6000)'));
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  for (const network of ['qortium', 'qortal']) {
    assert.equal(core[network].network, network);
    assert.equal(core[network].install, 'missing');
  }
  assert.equal(core.adoption.schema, 'home-v2-qortal-adoption-list');
  if (process.platform === 'darwin') {
    assert.equal(core.adoption.state, 'complete');
    assert.equal(core.adoption.canBrowse, true);
  } else {
    assert.equal(core.adoption.state, 'unsupported');
    assert.equal(core.adoption.code, 'unsupported-platform');
    assert.equal(core.adoption.canBrowse, false);
    const rejected = await cdp.evaluate("window.homeV2CoreManagers.selectQortalAdoptionCandidate('00000000-0000-4000-8000-000000000000')");
    assert.equal(rejected.outcome, 'blocked');
    assert.equal(rejected.code, 'unsupported-platform');
  }
  // A tab strip alone can render while shell initialization is still blocked.
  // Wait for either the initialized Dashboard or the first-run setup page.
  while (Date.now() < deadline) {
    state = await cdp.evaluate(`({ tabs: !!document.querySelector('.home-v2-tabs'), text: document.body?.innerText.slice(0, 6000) ?? '' })`);
    if (state.text.includes('Skip setup') || state.text.includes('Node & Core')) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(state.text.includes('Skip setup') || state.text.includes('Node & Core'),
    `The packaged shell must finish initialization: ${state.text}`);
  await cdp.send('Page.enable');
  const screenshot = await cdp.send('Page.captureScreenshot', {format: 'png'});
  mkdirSync('native-artifacts', {recursive: true});
  writeFileSync('native-artifacts/native-shell.png', screenshot.data, 'base64');
  writeFileSync('native-artifacts/native-shell.json', JSON.stringify({platform: process.platform, arch: process.arch, os: os.release(), ...state, core}, null, 2));
  console.log('Native packaged Home shell PASS');
} finally {
  cdp?.socket.close();
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {stdio: 'ignore'});
  } else {
    child.kill('SIGTERM');
  }
}
