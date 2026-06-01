#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const nodeApiUrl = (process.env.QORTIUM_HOME_NODE_API_URL ?? 'http://127.0.0.1:24891').replace(
  /\/+$/,
  '',
);
const accountRole = process.env.QORTIUM_HOME_SMOKE_ACCOUNT_ROLE ?? 'local';
const fixtureName = process.env.QORTIUM_HOME_QDN_WRITE_FIXTURE_NAME ?? 'QortiumHomeTest';
const fixtureIdentifier = process.env.QORTIUM_HOME_QDN_WRITE_FIXTURE_IDENTIFIER ?? 'home-test';
const fixtureAddress =
  process.env.QORTIUM_HOME_QDN_WRITE_FIXTURE ?? `qdn://APP/${fixtureName}/${fixtureIdentifier}`;
const previewAccountsPath = expandHomePath(
  process.env.QORTIUM_HOME_PREVIEW_ACCOUNTS_PATH ??
    '~/git/qortium/preview/secrets/initial-minting-accounts.json',
);
const apiKeyPath = expandHomePath(
  process.env.QORTIUM_HOME_NODE_API_KEY_PATH ?? '~/git/qortium/preview/apikey.txt',
);
const commandTimeoutMs = 120_000;
const appTimeoutMs = 90_000;
const cdpTimeoutMs = 90_000;
const qdnStatusTimeoutMs = 180_000;
const allScenarios = [
  'success',
  'deny-publish',
  'deny-delete',
  'no-account',
  'locked-account',
  'missing-api-key',
  'nonlocal-node',
  'stale-tab',
];
const qdnWriteSmokeScenarios = new Set(allScenarios);

function log(message) {
  console.log(`[desktop-qdn-write-smoke] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function getScenarioArgument() {
  for (const argument of process.argv.slice(2)) {
    if (argument === '--all') {
      return 'all';
    }

    if (argument.startsWith('--scenario=')) {
      return argument.slice('--scenario='.length).trim();
    }
  }

  return process.env.QORTIUM_HOME_DESKTOP_QDN_WRITE_SCENARIO?.trim() || 'success';
}

function getRequestedScenarios() {
  const scenario = getScenarioArgument();

  if (scenario === 'all') {
    return allScenarios;
  }

  if (!qdnWriteSmokeScenarios.has(scenario)) {
    fail(`Unknown desktop QDN write smoke scenario: ${scenario}.`);
  }

  return [scenario];
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function expandHomePath(filePath) {
  if (filePath === '~') {
    return os.homedir();
  }

  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}

function getBin(name) {
  const extension = process.platform === 'win32' ? '.cmd' : '';

  return path.join(repoRoot, 'node_modules', '.bin', `${name}${extension}`);
}

function assertTool(toolPath, label) {
  if (!existsSync(toolPath)) {
    fail(`${label} was not found at ${toolPath}. Run npm install first.`);
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd ?? repoRoot,
        env: options.env ?? process.env,
        timeout: options.timeout ?? commandTimeoutMs,
      },
      (error, stdout, stderr) => {
        if (error) {
          const output = `${stdout}${stderr}`.trim();
          reject(new Error(`${command} ${args.join(' ')} failed${output ? `:\n${output}` : ''}`));
          return;
        }

        resolve({ stderr, stdout });
      },
    );
  });
}

function createManagedProcess(command, args, options = {}) {
  const output = [];
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk) => output.push(String(chunk)));
  child.stderr?.on('data', (chunk) => output.push(String(chunk)));

  child.once('exit', (code, signal) => {
    if (!options.allowExit) {
      output.push(`\nProcess exited with code=${code} signal=${signal}\n`);
    }
  });

  return {
    child,
    output,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      child.kill('SIGTERM');
      await delay(500);

      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    },
  };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      server.close(() => resolve(port));
    });
  });
}

async function waitUntil(label, timeoutMs, action) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await action();

      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(1_000);
  }

  if (lastError instanceof Error) {
    fail(`${label} timed out: ${lastError.message}`);
  }

  fail(`${label} timed out.`);
}

async function fetchText(url, options = {}) {
  let response;

  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(`${url} was unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }

  return body;
}

async function fetchJson(url, options = {}) {
  const body = await fetchText(url, options);

  return JSON.parse(body);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readNodeApiKey() {
  const explicitKey = process.env.QORTIUM_HOME_NODE_API_KEY?.trim();

  if (explicitKey) {
    return explicitKey;
  }

  return readFileSync(apiKeyPath, 'utf8').trim();
}

function writeAppApiKeyFile(tempRoot) {
  const apiKeyPath = path.join(tempRoot, 'app-apikey.txt');

  writeFileSync(apiKeyPath, `${readNodeApiKey()}\n`, 'utf8');

  return apiKeyPath;
}

function getWalletId(address) {
  return `wallet:${address}`;
}

function writeLockedWalletStore(userDataDir, account) {
  const now = new Date().toISOString();
  const walletId = getWalletId(account.accountAddress);

  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(
    path.join(userDataDir, 'wallets.json'),
    `${JSON.stringify(
      {
        activeAccountId: walletId,
        version: 1,
        wallets: [
          {
            address: account.accountAddress,
            createdAt: now,
            encryptedWallet: {
              address0: account.accountAddress,
              encryptedSeed: '1',
              iv: '1',
              kdfThreads: 1,
              mac: '1',
              salt: '1',
              version: 2,
            },
            id: walletId,
            label: 'Locked Smoke Account',
            sourceFilename: 'locked-smoke.json',
            updatedAt: now,
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function getPreviewAccount() {
  const previewAccounts = readJson(previewAccountsPath);
  const account = previewAccounts.accounts?.find((item) => item.role === accountRole);

  if (!account?.accountAddress || !account?.accountPrivateKey) {
    fail(`Preview account role ${accountRole} was not found in ${previewAccountsPath}.`);
  }

  return account;
}

async function getOwnedPublishName(accountAddress) {
  const names = await fetchJson(`${nodeApiUrl}/names/address/${encodeURIComponent(accountAddress)}?limit=0`);

  if (!Array.isArray(names)) {
    fail(`Unexpected names response for ${accountAddress}.`);
  }

  const requestedName = process.env.QORTIUM_HOME_SMOKE_PUBLISH_NAME;

  if (requestedName) {
    if (!names.some((item) => item?.name === requestedName)) {
      fail(`Preview account does not own requested name ${requestedName}.`);
    }

    return requestedName;
  }

  if (names.some((item) => item?.name === fixtureName)) {
    return fixtureName;
  }

  const firstName = names.find((item) => typeof item?.name === 'string')?.name;

  if (!firstName) {
    fail(`Preview account ${accountAddress} does not own a registered name.`);
  }

  return firstName;
}

async function assertLocalCoreReady() {
  const status = await fetchJson(`${nodeApiUrl}/admin/status`);

  if (status?.isSynchronizing === true) {
    fail(`Local Core is still synchronizing at ${nodeApiUrl}.`);
  }

  return status;
}

async function getResourceStatus(service, name, identifier) {
  const identifierPath = identifier ? `/${encodeURIComponent(identifier)}` : '';

  return fetchJson(
    `${nodeApiUrl}/arbitrary/resource/status/${service}/${encodeURIComponent(name)}${identifierPath}`,
    {
      headers: {
        'X-API-KEY': readNodeApiKey(),
      },
    },
  );
}

async function getBuiltResourceStatus(service, name, identifier) {
  const identifierPath = identifier ? `/${encodeURIComponent(identifier)}` : '';

  return fetchJson(
    `${nodeApiUrl}/arbitrary/resource/status/${service}/${encodeURIComponent(name)}${identifierPath}?build=true`,
    {
      headers: {
        'X-API-KEY': readNodeApiKey(),
      },
    },
  );
}

async function waitForResourceStatus(service, name, identifier, expectedStatus, options = {}) {
  let lastStatus = 'unknown';

  try {
    return await waitUntil(`QDN ${service}/${name}/${identifier} ${expectedStatus}`, qdnStatusTimeoutMs, async () => {
      const status = options.build
        ? await getBuiltResourceStatus(service, name, identifier)
        : await getResourceStatus(service, name, identifier);

      lastStatus = status?.status
        ? `${status.status}: ${status.description ?? 'no description'}`
        : JSON.stringify(status);

      if (
        status?.status &&
        status.status !== expectedStatus &&
        ['BLOCKED', 'BUILD_FAILED', 'MISSING_DATA', 'UNSUPPORTED'].includes(status.status)
      ) {
        fail(`QDN ${service}/${name}/${identifier} status is ${lastStatus}.`);
      }

      return status?.status === expectedStatus ? status : null;
    });
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)} Last status: ${lastStatus}.`);
  }
}

async function assertFixtureReady() {
  const status = await getResourceStatus('APP', fixtureName, fixtureIdentifier);

  if (status?.status !== 'READY') {
    fail(
      `QDN APP fixture is not READY at ${fixtureAddress}. Run npm run qdn:bootstrap-test-data first.`,
    );
  }
}

function getElectronLaunch(electronBin, electronArgs) {
  if (!process.env.DISPLAY && process.platform === 'linux' && existsSync('/usr/bin/xvfb-run')) {
    return {
      args: ['-a', electronBin, ...electronArgs],
      command: '/usr/bin/xvfb-run',
    };
  }

  return {
    args: electronArgs,
    command: electronBin,
  };
}

class CdpClient {
  constructor(webSocketUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.webSocket = new WebSocket(webSocketUrl);
    this.ready = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('CDP WebSocket connection timed out.')), 15_000);

      this.webSocket.addEventListener(
        'open',
        () => {
          clearTimeout(timeoutId);
          resolve();
        },
        { once: true },
      );
      this.webSocket.addEventListener(
        'error',
        () => {
          clearTimeout(timeoutId);
          reject(new Error('CDP WebSocket connection failed.'));
        },
        { once: true },
      );
    });
    this.webSocket.addEventListener('message', (event) => this.handleMessage(event.data));
  }

  handleMessage(rawMessage) {
    const message = JSON.parse(rawMessage);

    if (!message.id) {
      return;
    }

    const pending = this.pending.get(message.id);

    if (!pending) {
      return;
    }

    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message || 'CDP command failed.'));
    } else {
      pending.resolve(message.result);
    }
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { reject, resolve });
      this.webSocket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.webSocket.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    fail(result.exceptionDetails.text || 'CDP evaluation failed.');
  }

  return result.result?.value;
}

async function getPageTarget(cdpPort, predicate, label) {
  return waitUntil(label, cdpTimeoutMs, async () => {
    const targets = await fetchJson(`http://127.0.0.1:${cdpPort}/json/list`);

    return targets.find(
      (target) =>
        target.type === 'page' &&
        target.webSocketDebuggerUrl &&
        typeof target.url === 'string' &&
        predicate(target.url),
    ) ?? null;
  });
}

async function navigateToFixture(client) {
  await waitUntil('Qortium Home address bar', appTimeoutMs, async () => {
    const found = await evaluate(client, "!!document.querySelector('#browser-address')");

    return found === true;
  });

  const result = await evaluate(
    client,
    `
      (async () => {
        const input = document.querySelector('#browser-address');
        const form = input && input.closest('form');
        if (!input || !form) return { ok: false, message: 'Address bar was not found.' };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        input.focus();
        setter.call(input, ${JSON.stringify(fixtureAddress)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return { ok: true, value: input.value };
      })()
    `,
  );

  if (!result?.ok) {
    fail(result?.message || 'Unable to navigate Qortium Home to the QDN fixture.');
  }
}

async function resolveNextWrite(client, buttonLabel = 'Approve') {
  await waitUntil('QDN write approval dialog', appTimeoutMs, async () => {
    const result = await evaluate(
      client,
      `
        (() => {
          const dialog = document.querySelector('[aria-label="QDN write request"]');
          if (!dialog) return null;
          const target = [...dialog.querySelectorAll('button')]
            .find((button) => button.textContent && button.textContent.trim() === ${JSON.stringify(buttonLabel)});
          if (!target) return { ok: false, message: ${JSON.stringify(`${buttonLabel} button was not found.`)} };
          target.click();
          return { ok: true };
        })()
      `,
    );

    if (result?.ok) {
      return true;
    }

    if (result?.message) {
      fail(result.message);
    }

    return null;
  });
}

async function isWriteDialogVisible(client) {
  return evaluate(client, "!!document.querySelector('[aria-label=\"QDN write request\"]')");
}

async function runQdnRequest(qdnClient, request) {
  return evaluate(
    qdnClient,
    `
      window.qdnRequest(${JSON.stringify(request)})
        .then((result) => ({ ok: true, result }))
        .catch((error) => ({ ok: false, message: String(error && error.message || error) }))
    `,
  );
}

async function runQdnRequestWithDialog(
  mainClient,
  qdnClient,
  request,
  buttonLabel = 'Approve',
  beforeResolve,
  allowRejection = false,
) {
  const requestPromise = evaluate(
    qdnClient,
    `
      window.qdnRequest(${JSON.stringify(request)})
        .then((result) => ({ ok: true, result }))
        .catch((error) => ({ ok: false, message: String(error && error.message || error) }))
    `,
  );

  if (beforeResolve) {
    await beforeResolve();
  }

  await resolveNextWrite(mainClient, buttonLabel);

  const result = await requestPromise;

  if (buttonLabel === 'Approve' && !result?.ok && !allowRejection) {
    fail(result?.message || `${request.action} failed.`);
  }

  if (buttonLabel !== 'Approve' && result?.ok) {
    fail(`${request.action} unexpectedly succeeded after ${buttonLabel}.`);
  }

  return result;
}

async function expectQdnRequestRejected(mainClient, qdnClient, request, expectedMessage) {
  const result = await runQdnRequest(qdnClient, request);

  if (result?.ok) {
    fail(`${request.action} unexpectedly succeeded.`);
  }

  if (expectedMessage && !String(result?.message ?? '').includes(expectedMessage)) {
    fail(`${request.action} failed with unexpected message: ${result?.message ?? 'unknown error'}`);
  }

  if (await isWriteDialogVisible(mainClient)) {
    fail(`${request.action} unexpectedly opened a write approval dialog.`);
  }

  return result;
}

async function requestCore(pathname, options = {}) {
  const apiKey = readNodeApiKey();

  return fetchText(`${nodeApiUrl}${pathname}`, {
    ...options,
    headers: {
      'X-API-KEY': apiKey,
      ...(options.headers ?? {}),
    },
  });
}

async function signAndProcess(rawUnsignedBytes58, privateKey58) {
  const apiKey = readNodeApiKey();
  const rawUnsignedWithNonce58 = await requestCore('/arbitrary/compute', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
    },
    body: rawUnsignedBytes58,
  });
  const signedBytes58 = await requestCore('/transactions/sign', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify({
      privateKey: privateKey58,
      transactionBytes: rawUnsignedWithNonce58,
    }),
  });

  return requestCore('/transactions/process', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
    },
    body: signedBytes58,
  });
}

async function cleanupResource({ account, identifier, name, service }) {
  try {
    const rawUnsignedBytes58 = await requestCore(
      `/arbitrary/resource/${service}/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}/delete?fee=0`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: '',
      },
    );

    await signAndProcess(rawUnsignedBytes58, account.accountPrivateKey);
    await waitForResourceStatus(service, name, identifier, 'DELETED');
    log(`Cleaned up ${service}/${name}/${identifier}.`);
  } catch (error) {
    log(`Cleanup skipped or failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function getPublishRequest({ identifier, name, service }) {
  return {
    action: 'PUBLISH_QDN_RESOURCE',
    description: 'Qortium Home desktop QDN write smoke test',
    fee: 0,
    identifier,
    name,
    service,
    title: 'Qortium Home Write Smoke',
  };
}

function getDeleteRequest({ identifier, name, service }) {
  return {
    action: 'DELETE_QDN_RESOURCE',
    fee: 0,
    identifier,
    name,
    service,
  };
}

async function assertResourceStatus(service, name, identifier, expectedStatus, options = {}) {
  const status = options.build
    ? await getBuiltResourceStatus(service, name, identifier)
    : await getResourceStatus(service, name, identifier);

  if (status?.status !== expectedStatus) {
    fail(
      `Expected ${service}/${name}/${identifier} to be ${expectedStatus}, found ${status?.status ?? 'unknown'}.`,
    );
  }

  return status;
}

async function saveNodeSettings(mainClient, request) {
  const result = await evaluate(
    mainClient,
    `
      window.qortiumHome.node.saveSettings(${JSON.stringify(request)})
        .then((settings) => ({ ok: true, settings }))
        .catch((error) => ({ ok: false, message: String(error && error.message || error) }))
    `,
  );

  if (!result?.ok) {
    fail(result?.message || 'Unable to save node settings.');
  }

  return result.settings;
}

async function makeQdnViewStale(mainClient) {
  await waitUntil('QDN write approval dialog', appTimeoutMs, async () => isWriteDialogVisible(mainClient));

  const result = await evaluate(
    mainClient,
    `
      window.qortiumHome.qdnViews.show({
        accountId: 'stale-smoke-account',
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        nodeApiUrl: ${JSON.stringify(nodeApiUrl)},
        renderUrl: ${JSON.stringify(`${nodeApiUrl}/render/APP/${fixtureName}/${fixtureIdentifier}`)},
        tabId: 'tab-1'
      })
        .then(() => ({ ok: true }))
        .catch((error) => ({ ok: false, message: String(error && error.message || error) }))
    `,
  );

  if (!result?.ok) {
    fail(result?.message || 'Unable to make QDN view stale.');
  }
}

async function runScenarioActions({
  account,
  apiKeyPathForApp,
  identifier,
  mainClient,
  publishName,
  qdnClient,
  scenario,
  service,
}) {
  const publishRequest = getPublishRequest({ identifier, name: publishName, service });
  const deleteRequest = getDeleteRequest({ identifier, name: publishName, service });

  switch (scenario) {
    case 'success':
      log(`Publishing ${service}/${publishName}/${identifier}.`);
      await runQdnRequestWithDialog(mainClient, qdnClient, publishRequest);
      await waitForResourceStatus(service, publishName, identifier, 'READY', { build: true });

      log(`Deleting ${service}/${publishName}/${identifier}.`);
      await runQdnRequestWithDialog(mainClient, qdnClient, deleteRequest);
      await waitForResourceStatus(service, publishName, identifier, 'DELETED');
      return { deleted: true, published: true };

    case 'deny-publish':
      log(`Denying publish for ${service}/${publishName}/${identifier}.`);
      await runQdnRequestWithDialog(mainClient, qdnClient, publishRequest, 'Deny');
      await assertResourceStatus(service, publishName, identifier, 'NOT_PUBLISHED');
      return { deleted: false, published: false };

    case 'deny-delete':
      log(`Publishing ${service}/${publishName}/${identifier} before denied delete.`);
      await runQdnRequestWithDialog(mainClient, qdnClient, publishRequest);
      await waitForResourceStatus(service, publishName, identifier, 'READY', { build: true });

      log(`Denying delete for ${service}/${publishName}/${identifier}.`);
      await runQdnRequestWithDialog(mainClient, qdnClient, deleteRequest, 'Deny');
      await assertResourceStatus(service, publishName, identifier, 'READY', { build: true });
      return { deleted: false, published: true };

    case 'no-account':
      await expectQdnRequestRejected(mainClient, qdnClient, publishRequest, 'No account is selected');
      await assertResourceStatus(service, publishName, identifier, 'NOT_PUBLISHED');
      return { deleted: false, published: false };

    case 'locked-account':
      await expectQdnRequestRejected(mainClient, qdnClient, publishRequest, 'Selected account is locked');
      await assertResourceStatus(service, publishName, identifier, 'NOT_PUBLISHED');
      return { deleted: false, published: false };

    case 'missing-api-key':
      rmSync(apiKeyPathForApp, { force: true });
      await runQdnRequestWithDialog(
        mainClient,
        qdnClient,
        publishRequest,
        'Approve',
        undefined,
        true,
      ).then((result) => {
        if (result?.ok || !String(result?.message ?? '').includes('API key')) {
          fail(`Missing API key scenario failed with unexpected result: ${JSON.stringify(result)}`);
        }
      });
      await assertResourceStatus(service, publishName, identifier, 'NOT_PUBLISHED');
      return { deleted: false, published: false };

    case 'nonlocal-node':
      await saveNodeSettings(mainClient, {
        customUrl: 'http://146.103.42.59:24891',
        mode: 'custom',
      });
      await expectQdnRequestRejected(mainClient, qdnClient, publishRequest, 'local Core node');
      await assertResourceStatus(service, publishName, identifier, 'NOT_PUBLISHED');
      return { deleted: false, published: false };

    case 'stale-tab': {
      const result = await runQdnRequestWithDialog(
        mainClient,
        qdnClient,
        publishRequest,
        'Approve',
        () => makeQdnViewStale(mainClient),
        true,
      );

      if (result?.ok || !String(result?.message ?? '').includes('stale')) {
        fail(`Stale tab scenario failed with unexpected result: ${JSON.stringify(result)}`);
      }

      await assertResourceStatus(service, publishName, identifier, 'NOT_PUBLISHED');
      return { deleted: false, published: false };
    }

    default:
      fail(`Scenario is not implemented: ${scenario}.`);
  }
}

async function runScenario({ account, electronBin, publishName, scenario, viteBin }) {
  const usesSmokeSigner = !['no-account', 'locked-account'].includes(scenario);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), `qortium-home-desktop-qdn-${scenario}-`));
  const userDataDir = path.join(tempRoot, 'user-data');
  const publishSourcePath = path.join(tempRoot, 'qdn-write-smoke.json');
  const appApiKeyPath = writeAppApiKeyFile(tempRoot);
  const service = 'JSON';
  const identifier = `home-write-${scenario}-${Date.now()}`;
  let viteProcess = null;
  let electronProcess = null;
  let published = false;
  let deleted = false;

  if (scenario === 'locked-account') {
    writeLockedWalletStore(userDataDir, account);
  }

  writeFileSync(
    publishSourcePath,
    `${JSON.stringify(
      {
        fixture: 'desktop-qdn-write-smoke',
        identifier,
        name: publishName,
        service,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const vitePort = await getFreePort();
  const cdpPort = await getFreePort();
  const devServerUrl = `http://127.0.0.1:${vitePort}`;
  const smokeEnv = {
    ...process.env,
    QORTIUM_HOME_NODE_API_URL: nodeApiUrl,
    QORTIUM_HOME_NODE_API_KEY_PATH: appApiKeyPath,
    QORTIUM_HOME_SMOKE_ACCOUNT_ROLE: accountRole,
    QORTIUM_HOME_QDN_WRITE_SMOKE_NAME: publishName,
    QORTIUM_HOME_QDN_WRITE_SMOKE_SOURCE: publishSourcePath,
    QORTIUM_HOME_USER_DATA_DIR: userDataDir,
    VITE_DEV_SERVER_URL: devServerUrl,
    XDG_CONFIG_HOME: path.join(tempRoot, 'config'),
  };

  delete smokeEnv.QORTIUM_HOME_NODE_API_KEY;

  if (usesSmokeSigner) {
    smokeEnv.QORTIUM_HOME_QDN_WRITE_SMOKE = '1';
  } else {
    delete smokeEnv.QORTIUM_HOME_QDN_WRITE_SMOKE;
  }

  try {
    log(`[${scenario}] Starting Vite on ${devServerUrl}.`);
    viteProcess = createManagedProcess(
      viteBin,
      ['--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
      { env: smokeEnv },
    );

    await waitUntil('Vite dev server', appTimeoutMs, async () => {
      const response = await fetch(devServerUrl).catch(() => null);

      return response?.ok === true;
    });

    const electronArgs = [`--remote-debugging-port=${cdpPort}`, '.'];
    const electronLaunch = getElectronLaunch(electronBin, electronArgs);

    log(`[${scenario}] Starting Electron with CDP on 127.0.0.1:${cdpPort}.`);
    electronProcess = createManagedProcess(electronLaunch.command, electronLaunch.args, { env: smokeEnv });

    const mainTarget = await getPageTarget(
      cdpPort,
      (url) => url.startsWith(devServerUrl),
      'Electron main page target',
    );
    const mainClient = new CdpClient(mainTarget.webSocketDebuggerUrl);

    try {
      await mainClient.send('Runtime.enable');
      await navigateToFixture(mainClient);

      const qdnTarget = await getPageTarget(
        cdpPort,
        (url) => url.includes(`/render/APP/${fixtureName}`),
        'QDN APP target',
      );
      const qdnClient = new CdpClient(qdnTarget.webSocketDebuggerUrl);

      try {
        await qdnClient.send('Runtime.enable');

        const bridgeState = await evaluate(qdnClient, 'typeof window.qdnRequest');
        if (bridgeState !== 'function') {
          fail(`Expected qdnRequest to be injected, found ${bridgeState}.`);
        }

        const whichUi = await evaluate(qdnClient, "window.qdnRequest({ action: 'WHICH_UI' })");
        if (whichUi !== 'QORTIUM_HOME_ELECTRON') {
          fail(`Expected QORTIUM_HOME_ELECTRON, found ${JSON.stringify(whichUi)}.`);
        }

        const actions = await evaluate(qdnClient, "window.qdnRequest({ action: 'SHOW_ACTIONS' })");
        for (const action of [
          'PUBLISH_QDN_RESOURCE',
          'DELETE_QDN_RESOURCE',
          'JOIN_GROUP',
          'SEND_CHAT_MESSAGE',
          'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
          'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
        ]) {
          if (!Array.isArray(actions) || !actions.includes(action)) {
            fail(`SHOW_ACTIONS did not include ${action}.`);
          }
        }

        const scenarioResult = await runScenarioActions({
          account,
          apiKeyPathForApp: appApiKeyPath,
          identifier,
          mainClient,
          publishName,
          qdnClient,
          scenario,
          service,
        });

        published = scenarioResult.published;
        deleted = scenarioResult.deleted;
        log(`[${scenario}] Desktop QDN permission smoke scenario passed.`);
      } finally {
        qdnClient.close();
      }
    } finally {
      mainClient.close();
    }
  } finally {
    if (published && !deleted) {
      await cleanupResource({ account, identifier, name: publishName, service });
    }

    await electronProcess?.stop();
    await viteProcess?.stop();

    if (process.env.QORTIUM_HOME_KEEP_DESKTOP_SMOKE_DATA !== '1') {
      rmSync(tempRoot, { force: true, recursive: true });
    } else {
      log(`Kept smoke data at ${tempRoot}.`);
    }

    if (viteProcess?.child.exitCode && viteProcess.child.exitCode !== 0) {
      log(`Vite output:\n${viteProcess.output.join('')}`);
    }

    if (electronProcess?.child.exitCode && electronProcess.child.exitCode !== 0) {
      log(`Electron output:\n${electronProcess.output.join('')}`);
    }
  }
}

async function main() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const electronBin = getBin('electron');
  const viteBin = getBin('vite');
  const scenarios = getRequestedScenarios();

  assertTool(electronBin, 'electron');
  assertTool(viteBin, 'vite');

  const account = getPreviewAccount();
  await assertLocalCoreReady();
  const publishName = await getOwnedPublishName(account.accountAddress);
  await assertFixtureReady();

  log(`Using preview account role ${accountRole} with name ${publishName}.`);
  log('Building Electron main process.');
  await run(npm, ['run', 'build:electron']);

  for (const scenario of scenarios) {
    log(`Running scenario: ${scenario}.`);
    await runScenario({ account, electronBin, publishName, scenario, viteBin });
  }

  log('Desktop QDN permission smoke test passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
