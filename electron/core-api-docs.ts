const DOCS_DISABLED_PATTERN = /currently disabled|api documentation disabled/i;

export type CoreApiDocsProbeResult =
  | { kind: 'available' }
  | { kind: 'disabled' }
  | { kind: 'forbidden' }
  | { kind: 'http-error'; status: number };

export type ResolvedCoreApiDocsProbeResult = Exclude<CoreApiDocsProbeResult, { kind: 'forbidden' }>
  | { kind: 'restricted' };

export function classifyCoreApiDocsProbe(
  status: number,
  body: string,
  tooLarge: boolean,
): CoreApiDocsProbeResult {
  if (status === 403) {
    return { kind: 'forbidden' };
  }

  if (status === 404) {
    return { kind: 'disabled' };
  }

  if (status < 200 || status >= 300) {
    return { kind: 'http-error', status };
  }

  if (!tooLarge && DOCS_DISABLED_PATTERN.test(body)) {
    return { kind: 'disabled' };
  }

  return { kind: 'available' };
}

export function resolveCoreApiDocsProbe(
  result: CoreApiDocsProbeResult,
  nodeMode: 'custom' | 'local' | 'network',
): ResolvedCoreApiDocsProbeResult {
  if (result.kind !== 'forbidden') {
    return result;
  }

  return { kind: nodeMode === 'custom' ? 'restricted' : 'disabled' };
}
