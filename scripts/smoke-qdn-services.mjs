#!/usr/bin/env node

// Drift guard for Home's QDN service whitelists. Home curates a static subset of
// Core's QDN services in two places (the renderer src/qdn.ts and the desktop bridge
// electron/qdn.ts). This smoke check reads both lists from source and verifies them
// against the node's GET /arbitrary/services catalogue (Core v1.1.0+), so a service
// that Core renames, drops, or reclassifies as private cannot silently rot in Home.
//
// It does NOT require Home to list every Core service: omissions (system/chat-internal
// services such as AUTO_UPDATE or QCHAT_*) are intentional and only reported, not failed.
//
// Needs a reachable Previewnet node. Override the URL with QORTIUM_HOME_NODE_API_URL.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Extracts the quoted service names from a `PUBLIC_QDN_SERVICES = [ ... ]` /
// `= new Set([ ... ])` literal in a source file, up to the first closing bracket.
function extractServiceList(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  const content = readFileSync(filePath, 'utf8');
  const startIndex = content.indexOf('PUBLIC_QDN_SERVICES');

  if (startIndex === -1) {
    fail(`Could not find PUBLIC_QDN_SERVICES in ${relativePath}.`);
  }

  const openIndex = content.indexOf('[', startIndex);
  const closeIndex = content.indexOf(']', openIndex);

  if (openIndex === -1 || closeIndex === -1) {
    fail(`Could not parse the PUBLIC_QDN_SERVICES literal in ${relativePath}.`);
  }

  const block = content.slice(openIndex, closeIndex);
  const names = [...block.matchAll(/'([A-Z0-9_]+)'/g)].map((match) => match[1]);

  assert(names.length > 0, `PUBLIC_QDN_SERVICES in ${relativePath} parsed to an empty list.`);

  return names;
}

function findDuplicates(names) {
  const seen = new Set();
  const duplicates = new Set();

  for (const name of names) {
    if (seen.has(name)) {
      duplicates.add(name);
    }

    seen.add(name);
  }

  return [...duplicates];
}

function diff(fromNames, toSet) {
  return fromNames.filter((name) => !toSet.has(name));
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

  const catalogue = await response.json();

  assert(Array.isArray(catalogue) && catalogue.length > 0, 'GET /arbitrary/services did not return a non-empty array.');

  return catalogue;
}

async function main() {
  log(`Node: ${nodeApiUrl}`);

  const rendererServices = extractServiceList('src/qdn.ts');
  const bridgeServices = extractServiceList('electron/qdn.ts');

  log(`Renderer whitelist: ${rendererServices.length} services. Bridge whitelist: ${bridgeServices.length} services.`);

  // 1. The two Home copies must stay byte-identical (same names, same order).
  const rendererDuplicates = findDuplicates(rendererServices);
  const bridgeDuplicates = findDuplicates(bridgeServices);

  assert(rendererDuplicates.length === 0, `src/qdn.ts lists duplicate services: ${rendererDuplicates.join(', ')}.`);
  assert(bridgeDuplicates.length === 0, `electron/qdn.ts lists duplicate services: ${bridgeDuplicates.join(', ')}.`);

  assert(
    rendererServices.length === bridgeServices.length &&
      rendererServices.every((name, index) => name === bridgeServices[index]),
    `The renderer (src/qdn.ts) and bridge (electron/qdn.ts) service whitelists differ.\n` +
      `  Only in renderer: ${diff(rendererServices, new Set(bridgeServices)).join(', ') || '(none)'}\n` +
      `  Only in bridge:   ${diff(bridgeServices, new Set(rendererServices)).join(', ') || '(none)'}`,
  );

  log('Renderer and bridge whitelists match.');

  // 2. Compare against Core's live catalogue.
  const catalogue = await fetchServiceCatalogue();
  const coreById = new Map(catalogue.map((service) => [service.id, service]));
  const corePublicIds = catalogue.filter((service) => service.private === false).map((service) => service.id);

  log(`Core catalogue: ${catalogue.length} services (${corePublicIds.length} public).`);

  // Every Home-listed service must still exist in Core.
  const unknownToCore = diff(rendererServices, new Set(coreById.keys()));
  assert(
    unknownToCore.length === 0,
    `Home lists service(s) that Core no longer reports: ${unknownToCore.join(', ')}. ` +
      `They were renamed or removed in Core; update the whitelists.`,
  );

  // Home browses public services only — none of its entries may be private in Core.
  const privateInCore = rendererServices.filter((name) => coreById.get(name)?.private === true);
  assert(
    privateInCore.length === 0,
    `Home lists service(s) that Core reports as private: ${privateInCore.join(', ')}. ` +
      `Private services need the encrypted-resource flow, not the public whitelist.`,
  );

  log('All Home services exist in Core and are public.');

  // 3. Informational: public Core services Home does not surface (intentional omissions).
  const notSurfaced = diff(corePublicIds, new Set(rendererServices));

  if (notSurfaced.length > 0) {
    log(`Note: ${notSurfaced.length} public Core service(s) are not surfaced by Home (expected for system/chat-internal services): ${notSurfaced.join(', ')}.`);
  }

  log('PASS: QDN service whitelists are consistent with Core.');
}

main().catch((error) => {
  console.error(`[qdn-services-smoke] FAIL: ${error.message}`);
  process.exitCode = 1;
});
