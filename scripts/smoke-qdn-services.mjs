#!/usr/bin/env node

// Drift guard for Home's QDN service whitelist. Home curates a static subset of
// Core's QDN services in electron/qdn-public-services.ts. This smoke check reads
// that list — the real exported value, from the compiled module, not a regex over
// the source — and verifies it against the node's GET /arbitrary/services
// catalogue (Core v1.1.0+), so a service that Core renames, drops, or
// reclassifies as private cannot silently rot in Home.
//
// It does NOT require Home to list every Core service: omissions (system/chat-internal
// services such as AUTO_UPDATE or QCHAT_*) are intentional and only reported, not failed.
//
// The comparison itself lives in scripts/qdn-services-drift.mjs and is covered by
// scripts/test-qdn-services-drift.mjs; the offline half of this check (list shape,
// duplicates, predicate self-consistency) moved into electron/qdn-public-services.test.ts
// so it runs in `npm test`. What is left here is only what needs a real node.
//
// Needs a reachable Previewnet node. Override the URL with QORTIUM_HOME_NODE_API_URL.
// Needs dist-electron/ built (`npm run build:electron`).

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { findCatalogueDrift } from './qdn-services-drift.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const nodeApiUrl = (process.env.QORTIUM_HOME_NODE_API_URL ?? 'http://127.0.0.1:24891').replace(/\/+$/, '');
const nodeApiKey = process.env.QORTIUM_HOME_NODE_API_KEY ?? '';
const requestTimeoutMs = 15_000;

function log(message) {
  console.log(`[qdn-services-smoke] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

// The list is a single exported constant in a module with no imports, so the
// compiled output can just be imported and asked for its actual value.
async function loadHomeServices() {
  const moduleUrl = pathToFileURL(path.join(repoRoot, 'dist-electron', 'qdn-public-services.js'));

  let module;

  try {
    module = await import(moduleUrl.href);
  } catch (error) {
    fail(
      `Could not import dist-electron/qdn-public-services.js: ${error.message}. ` +
        `Run \`npm run build:electron\` first.`,
    );
  }

  const { PUBLIC_QDN_SERVICES, isPrivateQdnService } = module;

  assert(
    Array.isArray(PUBLIC_QDN_SERVICES) && PUBLIC_QDN_SERVICES.length > 0,
    'dist-electron/qdn-public-services.js exported no PUBLIC_QDN_SERVICES list.',
  );
  assert(
    typeof isPrivateQdnService === 'function',
    'dist-electron/qdn-public-services.js exported no isPrivateQdnService predicate.',
  );

  return { homeServices: [...PUBLIC_QDN_SERVICES], isPrivateQdnService };
}

async function fetchServiceCatalogue() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  let response;

  try {
    response = await fetch(`${nodeApiUrl}/arbitrary/services`, {
      headers: nodeApiKey ? { 'X-API-KEY': nodeApiKey } : {},
      signal: controller.signal,
    });
  } catch (error) {
    fail(`Could not reach the node at ${nodeApiUrl}/arbitrary/services: ${error.message}. Start a Previewnet node or set QORTIUM_HOME_NODE_API_URL.`);
  } finally {
    clearTimeout(timeout);
  }

  assert(response.ok, `GET /arbitrary/services returned HTTP ${response.status}.`);

  return response.json();
}

async function main() {
  log(`Node: ${nodeApiUrl}`);

  const { homeServices, isPrivateQdnService } = await loadHomeServices();

  log(`Home whitelist: ${homeServices.length} services (from dist-electron/qdn-public-services.js).`);

  const catalogue = await fetchServiceCatalogue();
  const { failures, notes, coreCount, corePublicCount } = findCatalogueDrift({
    homeServices,
    catalogue,
    isPrivateService: isPrivateQdnService,
  });

  log(`Core catalogue: ${coreCount} services (${corePublicCount} public).`);

  for (const note of notes) {
    log(`Note: ${note}`);
  }

  assert(failures.length === 0, failures.join('\n  '));

  log('All Home services exist in Core and are public.');
  log("Home's private-service rule agrees with Core's private flag across the catalogue.");
  log('PASS: QDN service whitelist is consistent with Core.');
}

main().catch((error) => {
  console.error(`[qdn-services-smoke] FAIL: ${error.message}`);
  process.exitCode = 1;
});
