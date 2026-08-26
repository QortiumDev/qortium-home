import { HOME_V2_NAME_WRITE_ACTIONS } from './home-v2-app-actions.js';

export type PublicNameCapabilities = {
  actions: readonly string[];
  mempowFeeAlternativeDifficulty: number;
  protocolVersion: 1;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function capabilityError(message: string) {
  return Object.assign(new Error(message), { code: 'QDN_PUBLIC_NAME_CAPABILITY_UNAVAILABLE' });
}

// Mirrors parsePublicPollCapabilities for Core's GET /names/public/capabilities
// (qortium-core PR #269): the same protocol shape, with the five name actions
// required before any name write is attempted against the node.
export function parsePublicNameCapabilities(value: unknown): PublicNameCapabilities {
  if (!isRecord(value)
    || value.protocolVersion !== 1
    || !Array.isArray(value.actions)
    || !Number.isInteger(value.mempowFeeAlternativeDifficulty)
    || (value.mempowFeeAlternativeDifficulty as number) < 1
    || (value.mempowFeeAlternativeDifficulty as number) > 31) {
    throw capabilityError('The selected node does not expose a compatible name builder.');
  }

  const actions = value.actions.filter((action): action is string => typeof action === 'string');
  if (!HOME_V2_NAME_WRITE_ACTIONS.every((action) => actions.includes(action))) {
    throw capabilityError('The selected node does not support all name write actions.');
  }

  return {
    protocolVersion: 1,
    actions,
    mempowFeeAlternativeDifficulty: value.mempowFeeAlternativeDifficulty as number,
  };
}
