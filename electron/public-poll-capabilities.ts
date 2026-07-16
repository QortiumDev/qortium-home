import { QDN_POLL_ACTIONS } from './qdn-app-actions.js';

export type PublicPollCapabilities = {
  actions: readonly string[];
  mempowFeeAlternativeDifficulty: number;
  protocolVersion: 1;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function capabilityError(message: string) {
  return Object.assign(new Error(message), { code: 'QDN_PUBLIC_POLL_CAPABILITY_UNAVAILABLE' });
}

export function parsePublicPollCapabilities(value: unknown): PublicPollCapabilities {
  if (!isRecord(value)
    || value.protocolVersion !== 1
    || !Array.isArray(value.actions)
    || !Number.isInteger(value.mempowFeeAlternativeDifficulty)
    || (value.mempowFeeAlternativeDifficulty as number) < 1
    || (value.mempowFeeAlternativeDifficulty as number) > 31) {
    throw capabilityError('The selected public node does not expose a compatible poll builder.');
  }

  const actions = value.actions.filter((action): action is string => typeof action === 'string');
  if (!QDN_POLL_ACTIONS.every((action) => actions.includes(action))) {
    throw capabilityError('The selected public node does not support all poll write actions.');
  }

  return {
    protocolVersion: 1,
    actions,
    mempowFeeAlternativeDifficulty: value.mempowFeeAlternativeDifficulty as number,
  };
}
