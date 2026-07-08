import { app, net, session as electronSession, type Session } from 'electron';
import { X509Certificate } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';

type NodeFetchInit = RequestInit & { duplex?: 'half' };

const NODE_CA_DIR = 'node-ca';
const CREATE_CA_RESTART_DELAY_MS = 3_000;
const GET_CA_RETRY_COUNT = 4;
const GET_CA_RETRY_DELAY_MS = 1_000;
const storedCaByKey = new Map<string, string>();
const ensureCaByKey = new Map<string, Promise<boolean>>();
const configuredNodeHosts = new Set<string>();
const installedVerifyProcSessions = new Set<Session>();

export function nodeFetch(input: string | Request, init?: NodeFetchInit): Promise<Response> {
  return net.fetch(input, init as RequestInit);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePem(pem: string) {
  return pem.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeHostname(hostname: string) {
  const host = hostname.trim().toLowerCase();

  if (host.startsWith('[') && host.endsWith(']')) {
    return host.slice(1, -1);
  }

  return host;
}

function sanitizeFilenamePart(value: string) {
  return value.replace(/[^a-z0-9.-]/gi, '_').slice(0, 120) || 'node';
}

function getNodeCaDir() {
  return path.join(app.getPath('userData'), NODE_CA_DIR);
}

function getNodeCaKey(url: URL) {
  const hostname = normalizeHostname(url.hostname);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');

  return `${hostname}:${port}`;
}

function getNodeCaPath(url: URL) {
  const hostname = normalizeHostname(url.hostname);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');

  return path.join(getNodeCaDir(), `${sanitizeFilenamePart(hostname)}_${sanitizeFilenamePart(port)}.pem`);
}

function parseCertificate(pem: string): X509Certificate | null {
  try {
    return new X509Certificate(pem);
  } catch {
    return null;
  }
}

function isValidCertificatePem(pem: string) {
  return !!parseCertificate(pem);
}

function readStoredCa(url: URL) {
  const key = getNodeCaKey(url);
  const cached = storedCaByKey.get(key);

  if (cached) {
    return cached;
  }

  try {
    const caPem = normalizePem(readFileSync(getNodeCaPath(url), 'utf8'));

    if (!isValidCertificatePem(caPem)) {
      return null;
    }

    storedCaByKey.set(key, caPem);
    configuredNodeHosts.add(normalizeHostname(url.hostname));

    return caPem;
  } catch {
    return null;
  }
}

function readStoredCasForHost(hostname: string) {
  const normalizedHostname = normalizeHostname(hostname);
  const filenamePrefix = `${sanitizeFilenamePart(normalizedHostname)}_`;
  const cas = [...storedCaByKey.entries()]
    .filter(([key]) => key.startsWith(`${normalizedHostname}:`))
    .map(([, caPem]) => caPem);

  try {
    for (const filename of readdirSync(getNodeCaDir())) {
      if (!filename.startsWith(filenamePrefix) || !filename.endsWith('.pem')) {
        continue;
      }

      const caPem = normalizePem(readFileSync(path.join(getNodeCaDir(), filename), 'utf8'));

      if (isValidCertificatePem(caPem) && !cas.includes(caPem)) {
        cas.push(caPem);
      }
    }
  } catch {
    // Missing or unreadable CA directory means there is nothing for us to handle.
  }

  return cas;
}

function writeStoredCa(url: URL, caPem: string) {
  const normalizedPem = normalizePem(caPem);

  if (!isValidCertificatePem(normalizedPem)) {
    return false;
  }

  mkdirSync(getNodeCaDir(), { recursive: true });
  writeFileSync(getNodeCaPath(url), `${normalizedPem}\n`, 'utf8');
  storedCaByKey.set(getNodeCaKey(url), normalizedPem);
  configuredNodeHosts.add(normalizeHostname(url.hostname));

  return true;
}

function buildHttpCaUrl(url: URL, pathname: string) {
  const caUrl = new URL(url.toString());
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');

  caUrl.protocol = 'http:';
  caUrl.port = port;
  caUrl.pathname = pathname;
  caUrl.search = '';
  caUrl.hash = '';

  return caUrl.toString();
}

async function fetchNodeCa(url: URL) {
  const response = await nodeFetch(buildHttpCaUrl(url, '/admin/http/getca'), {
    headers: { Accept: 'text/plain' },
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    return null;
  }

  const caPem = normalizePem(await response.text());

  return caPem && isValidCertificatePem(caPem) ? caPem : null;
}

async function createNodeCa(url: URL, apiKey: string) {
  const response = await nodeFetch(buildHttpCaUrl(url, '/admin/http/createca'), {
    method: 'POST',
    headers: {
      Accept: 'text/plain',
      'X-API-KEY': apiKey,
    },
    signal: AbortSignal.timeout(5_000),
  });

  return response.ok;
}

async function ensureNodeCaUncached(url: URL, apiKey: string | null) {
  try {
    const existingCa = readStoredCa(url);

    if (existingCa) {
      return true;
    }

    let caPem = await fetchNodeCa(url).catch(() => null);

    if (!caPem && apiKey) {
      await createNodeCa(url, apiKey).catch(() => false);
      await delay(CREATE_CA_RESTART_DELAY_MS);

      for (let attempt = 0; attempt < GET_CA_RETRY_COUNT && !caPem; attempt += 1) {
        caPem = await fetchNodeCa(url).catch(() => null);

        if (!caPem && attempt < GET_CA_RETRY_COUNT - 1) {
          await delay(GET_CA_RETRY_DELAY_MS);
        }
      }
    }

    return !!caPem && writeStoredCa(url, caPem);
  } catch {
    return false;
  }
}

export async function ensureNodeCa(nodeApiUrl: string, apiKey: string | null): Promise<boolean> {
  let url: URL;

  try {
    url = new URL(nodeApiUrl);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') {
    return true;
  }

  configuredNodeHosts.add(normalizeHostname(url.hostname));

  if (readStoredCa(url)) {
    return true;
  }

  const key = getNodeCaKey(url);
  const cachedEnsure = ensureCaByKey.get(key);

  if (cachedEnsure) {
    return cachedEnsure;
  }

  const ensurePromise = ensureNodeCaUncached(url, apiKey?.trim() || null);
  ensureCaByKey.set(key, ensurePromise);

  if (!(await ensurePromise)) {
    ensureCaByKey.delete(key);
    return false;
  }

  return true;
}

function isPrivateOrLoopbackHost(hostname: string) {
  const host = normalizeHostname(hostname);

  if (host === 'localhost') {
    return true;
  }

  if (isIP(host) === 4) {
    const parts = host.split('.').map((part) => Number(part));

    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }

    const [first, second] = parts;

    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  if (isIP(host) === 6) {
    if (host === '::1') {
      return true;
    }

    const firstHextet = Number.parseInt(host.split(':')[0], 16);

    return (
      Number.isFinite(firstHextet) &&
      (((firstHextet & 0xfe00) === 0xfc00) || ((firstHextet & 0xffc0) === 0xfe80))
    );
  }

  return false;
}

function isEligibleNodeTlsHost(hostname: string) {
  const host = normalizeHostname(hostname);

  return isPrivateOrLoopbackHost(host) || configuredNodeHosts.has(host);
}

function isCertificateCurrentlyValid(certificate: X509Certificate) {
  const now = Date.now();
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);

  return Number.isFinite(validFrom) && Number.isFinite(validTo) && validFrom <= now && now <= validTo;
}

export function verifyAgainstStoredCa(hostname: string, certificatePem: string): boolean {
  if (!isEligibleNodeTlsHost(hostname)) {
    return false;
  }

  const leaf = parseCertificate(certificatePem);

  if (!leaf || !isCertificateCurrentlyValid(leaf)) {
    return false;
  }

  for (const caPem of readStoredCasForHost(hostname)) {
    const ca = parseCertificate(caPem);

    if (ca && leaf.checkIssued(ca) && leaf.verify(ca.publicKey)) {
      return true;
    }
  }

  return false;
}

export function installCertificateVerifyProc(targetSession: Session) {
  if (installedVerifyProcSessions.has(targetSession)) {
    return;
  }

  targetSession.setCertificateVerifyProc((request, callback) => {
    if (request.errorCode === 0) {
      callback(-3);
      return;
    }

    if (
      isEligibleNodeTlsHost(request.hostname) &&
      request.certificate?.data &&
      verifyAgainstStoredCa(request.hostname, request.certificate.data)
    ) {
      callback(0);
      return;
    }

    callback(-3);
  });
  installedVerifyProcSessions.add(targetSession);
}

export function installNodeTlsForDefaultSessions() {
  installCertificateVerifyProc(electronSession.defaultSession);
}
