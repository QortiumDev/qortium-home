import { isLoopbackHostname } from './node-ca-bootstrap.js';

const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function normalizeNodeApiUrl(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    throw new Error('Node URL is required.');
  }

  const hasExplicitScheme = EXPLICIT_SCHEME.test(trimmedValue);
  let url: URL;

  try {
    url = new URL(hasExplicitScheme ? trimmedValue : `http://${trimmedValue}`);
  } catch {
    throw new Error('Enter a valid node URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Node URL must use HTTP or HTTPS.');
  }

  if (url.username || url.password) {
    throw new Error('Node URL cannot include a username or password.');
  }

  if (!url.hostname) {
    throw new Error('Node URL must include a host.');
  }

  // A missing scheme is safe to infer only on this machine. Everywhere else,
  // choose TLS so the user reaches Home's certificate-confirmation flow before
  // any configured API key can be used.
  if (!hasExplicitScheme && !isLoopbackHostname(url.hostname)) {
    url.protocol = 'https:';
  }

  return url.origin;
}

export function isNodeApiKeyTransportSafe(nodeApiUrl: string) {
  try {
    const url = new URL(nodeApiUrl);

    return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHostname(url.hostname));
  } catch {
    return false;
  }
}
