import assert from 'node:assert/strict';
import { selectAcceptedLocalApiKey } from './local-api-key-adoption.js';

const accepting = (accepted: string, unreachable = false) => async (key: string) =>
  unreachable ? null : key === accepted;

// The current key still works: nothing changes and no candidate is probed.
{
  const probed: string[] = [];
  const result = await selectAcceptedLocalApiKey({
    current: 'runtime-key',
    candidates: ['preview-key'],
    probe: async (key) => { probed.push(key); return key === 'runtime-key'; },
  });
  assert.deepEqual(result, { apiKey: 'runtime-key', adopted: false });
  assert.deepEqual(probed, ['runtime-key']);
}

// The Core rejects the runtime key but accepts the install-tree key: adopt it.
{
  const result = await selectAcceptedLocalApiKey({
    current: 'runtime-key',
    candidates: ['runtime-key', 'preview-key'],
    probe: accepting('preview-key'),
  });
  assert.deepEqual(result, { apiKey: 'preview-key', adopted: true });
}

// No key at all (Home did not start the Core, no introspection): the first
// accepted candidate wins; empty/duplicate candidates are skipped.
{
  const probed: string[] = [];
  const result = await selectAcceptedLocalApiKey({
    current: '',
    candidates: ['', null, 'runtime-key', 'runtime-key', 'preview-key'],
    probe: async (key) => { probed.push(key); return key === 'preview-key'; },
  });
  assert.deepEqual(result, { apiKey: 'preview-key', adopted: true });
  assert.deepEqual(probed, ['runtime-key', 'preview-key']);
}

// An unreachable Core is not a rejection: keep the current key, probe nothing else.
{
  const probed: string[] = [];
  const result = await selectAcceptedLocalApiKey({
    current: 'runtime-key',
    candidates: ['preview-key'],
    probe: async (key) => { probed.push(key); return null; },
  });
  assert.deepEqual(result, { apiKey: 'runtime-key', adopted: false });
  assert.deepEqual(probed, ['runtime-key']);
}

// Everything rejected: keep what we had (the caller's existing empty-key path applies).
{
  const result = await selectAcceptedLocalApiKey({
    current: 'runtime-key',
    candidates: ['preview-key'],
    probe: async () => false,
  });
  assert.deepEqual(result, { apiKey: 'runtime-key', adopted: false });
}

console.log('local API key adoption tests passed');
