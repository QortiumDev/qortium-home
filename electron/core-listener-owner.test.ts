import assert from 'node:assert/strict';
import {
  observeCoreListenerOwners,
  parseLinuxListeningSocketInodes,
  type CoreListenerOwnerOperations,
} from './core-listener-owner.js';

const HEADER = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode';
const TCP = `${HEADER}\n   0: 0100007F:3067 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000 0 12345`;
assert.deepEqual([...parseLinuxListeningSocketInodes(TCP, 12391)], ['12345']);
assert.equal(parseLinuxListeningSocketInodes(TCP, 24891).size, 0);

function operations(values: { tcp?: string; tcp6?: string; links?: Record<string, string> }): CoreListenerOwnerOperations {
  return {
    getCurrentUserId: () => 1000,
    listProcessIds: async () => [100, 200],
    readDirectory: async (targetPath) => targetPath === '/proc' ? ['100', '200', 'self'] :
      targetPath === '/proc/100/fd' ? ['3', '4'] : targetPath === '/proc/200/fd' ? ['7'] : [],
    readLink: async (targetPath) => values.links?.[targetPath] ?? 'pipe:[9]',
    readProcessUserId: async () => 1000,
    readText: async (targetPath) => targetPath.endsWith('tcp6') ? values.tcp6 ?? HEADER : values.tcp ?? HEADER,
  };
}

assert.deepEqual(await observeCoreListenerOwners(12391, { platform: 'darwin' }), {
  kind: 'unknown', reason: 'Strong listener ownership is currently Linux-only.',
});
assert.deepEqual(await observeCoreListenerOwners(12391, { platform: 'linux', operations: operations({}) }), { kind: 'absent' });
assert.deepEqual(await observeCoreListenerOwners(12391, { platform: 'linux',
  operations: operations({ tcp: TCP, links: { '/proc/100/fd/3': 'socket:[12345]' } }) }), { kind: 'owners', pids: [100] });
assert.equal((await observeCoreListenerOwners(12391, { platform: 'linux', operations: operations({ tcp: TCP }) })).kind, 'unknown');

assert.deepEqual(await observeCoreListenerOwners(12391, { platform: 'linux', operations: operations({ tcp: TCP,
  links: { '/proc/100/fd/3': 'socket:[12345]', '/proc/200/fd/7': 'socket:[12345]' } }) }),
{ kind: 'owners', pids: [100, 200] }, 'all same-user holders of a shared listening socket must be reported');

{
  const values = operations({ tcp: TCP, links: { '/proc/100/fd/3': 'socket:[12345]' } });
  values.readDirectory = async (targetPath) => {
    if (targetPath === '/proc') return ['100', '200'];
    if (targetPath === '/proc/100/fd') return ['3'];
    throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
  };
  assert.deepEqual(await observeCoreListenerOwners(12391, { platform: 'linux', operations: values }),
    { kind: 'owners', pids: [100] }, 'an unrelated protected process must not make known ownership unusable');
}

{
  const values = operations({ tcp: TCP });
  values.readDirectory = async () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); };
  assert.equal((await observeCoreListenerOwners(12391, { platform: 'linux', operations: values })).kind, 'unknown',
    'a listener held only by an uninspectable process must remain unknown');
}

console.log('Core listener owner checks passed.');
