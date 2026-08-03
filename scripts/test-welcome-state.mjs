import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const sourcePath = new URL('../src/welcomeState.ts', import.meta.url);
const source = (await readFile(sourcePath, 'utf8'))
  .replace("import { Capacitor } from '@capacitor/core';\n", '')
  .replace("import { Preferences } from '@capacitor/preferences';\n", '');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const storage = new Map();
const capacitor = { native: false, isNativePlatform: () => capacitor.native };
const preferences = {
  async get({ key }) {
    return { value: storage.get(key) ?? null };
  },
  async set({ key, value }) {
    storage.set(key, value);
  },
};

globalThis.__welcomeTestCapacitor = capacitor;
globalThis.__welcomeTestPreferences = preferences;
globalThis.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  },
};

const welcome = await import(`data:text/javascript,${encodeURIComponent(
  'const Capacitor = globalThis.__welcomeTestCapacitor;\n'
    + 'const Preferences = globalThis.__welcomeTestPreferences;\n'
    + compiled,
)}`);

const valid = {
  currentStep: 'account',
  status: 'in-progress',
  updatedAt: '2026-07-14T12:00:00.000Z',
  version: 1,
};
assert.deepEqual(welcome.normalizeWelcomeState(valid), valid);
assert.equal(welcome.normalizeWelcomeState({ ...valid, version: 2 }), null);
assert.equal(welcome.normalizeWelcomeState({ ...valid, currentStep: 'unknown' }), null);
assert.equal(welcome.normalizeWelcomeState({ ...valid, updatedAt: 'not-a-date' }), null);

// Reopening a finished wizard restarts it from the first step; an
// in-progress one resumes where it left off.
assert.equal(welcome.getInitialWelcomeStep(welcome.createWelcomeState('in-progress', 'account')), 'account');
assert.equal(welcome.getInitialWelcomeStep(welcome.createWelcomeState('in-progress', 'finish')), 'finish');
assert.equal(welcome.getInitialWelcomeStep(welcome.createWelcomeState('completed', 'finish')), 'node');
assert.equal(welcome.getInitialWelcomeStep(welcome.createWelcomeState('skipped', 'finish')), 'node');

assert.equal(welcome.hasExistingProfileFootprint({ hasAccounts: true, storedValues: {} }), true);
assert.equal(welcome.hasExistingProfileFootprint({
  hasAccounts: false,
  storedValues: { 'qortium-home-bookmarks': '{"version":3}' },
}), true);
assert.equal(welcome.hasExistingProfileFootprint({
  hasAccounts: false,
  storedValues: { 'qortium-home-bookmarks': ' ' },
}), false);

storage.clear();
const fresh = await welcome.loadWelcomeState();
assert.equal(fresh.status, 'in-progress');
assert.equal(fresh.currentStep, 'node');
assert.deepEqual(JSON.parse(storage.get(welcome.WELCOME_STATE_STORAGE_KEY)), fresh);

storage.clear();
storage.set('qortium-home-start-pages', '["qdn://APP"]');
const legacy = await welcome.loadWelcomeState();
assert.equal(legacy.status, 'skipped');
assert.equal(legacy.currentStep, 'finish');

storage.clear();
storage.set('qortium-home-dashboard-pins', '[{"id":"legacy-pin"}]');
const legacyPins = await welcome.loadWelcomeState();
assert.equal(legacyPins.status, 'skipped');
assert.equal(legacyPins.currentStep, 'finish');

storage.clear();
storage.set('qortium-home-notification-store', '{"grants":{"legacy":true}}');
const legacyNotifications = await welcome.loadWelcomeState();
assert.equal(legacyNotifications.status, 'skipped');
assert.equal(legacyNotifications.currentStep, 'finish');

storage.clear();
window.qortiumHome = {
  node: { hasStoredSettings: async () => true },
  qdn: { hasNotificationStore: async () => false },
};
const legacyDesktopNode = await welcome.loadWelcomeState();
assert.equal(legacyDesktopNode.status, 'skipped');
assert.equal(legacyDesktopNode.currentStep, 'finish');
delete window.qortiumHome;

storage.clear();
const saved = welcome.createWelcomeState('completed', 'finish', '2026-07-14T12:00:00.000Z');
await welcome.saveWelcomeState(saved);
assert.deepEqual(await welcome.loadWelcomeState(), saved);

storage.clear();
capacitor.native = true;
await welcome.saveWelcomeState(saved);
assert.deepEqual(await welcome.loadWelcomeState(), saved);
capacitor.native = false;

const startPagesSource = (await readFile(new URL('../src/startPages.ts', import.meta.url), 'utf8'))
  .replace("import { Capacitor } from '@capacitor/core';\n", '')
  .replace("import { Preferences } from '@capacitor/preferences';\n", '')
  .replace("import { getSavedAccountContext } from './accountContext';\n", '');
const startPagesCompiled = ts.transpileModule(startPagesSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const startPages = await import(`data:text/javascript,${encodeURIComponent(
  'const Capacitor = globalThis.__welcomeTestCapacitor;\n'
    + 'const Preferences = globalThis.__welcomeTestPreferences;\n'
    + 'const getSavedAccountContext = (_displayUrl, accountId) => accountId ?? null;\n'
    + startPagesCompiled,
)}`);

assert.deepEqual(startPages.addStartPage([], 'home://welcome', null), []);
assert.deepEqual(startPages.addStartPage([], 'home://welcome/', null), []);
await startPages.saveStartPages([{ accountId: null, displayUrl: 'home://welcome' }]);
assert.deepEqual(await startPages.loadStartPages(), []);
storage.set('qortium-home-start-pages', '["home://welcome"]');
assert.deepEqual(await startPages.loadStartPages(), []);

console.log('Welcome state migration and Start-page exclusion tests passed.');
