import assert from 'node:assert/strict';
import { mergeBootstrapPeerList } from './core-bootstrap-peers.js';
import { QORTIUM_CORE_DESCRIPTOR } from './core-network-descriptor.js';

const chain = '3u25ana5e5hvriqqiuh6fcetxezsqm7la276ljtjxaoxt767n4hq.b32.i2p';
const data = 'hg3seiuul4pcz6a2svatdahzudphbm464vwqcmiejc77kumglwaq.b32.i2p';
const custom = '198.51.100.30:24892';
const opaque = { operatorSetting: true };
const old = ['146.103.42.59:24892', `${chain}:0`, data.toUpperCase(), custom, custom, opaque];
const before = JSON.stringify(old);
const result = mergeBootstrapPeerList(old, QORTIUM_CORE_DESCRIPTOR.bootstrap.initialPeers);
assert.equal(result.changed, true);
assert.equal(JSON.stringify(old), before);
assert.deepEqual(result.peers, [custom, opaque, ...QORTIUM_CORE_DESCRIPTOR.bootstrap.initialPeers]);
assert.deepEqual(mergeBootstrapPeerList(result.peers, QORTIUM_CORE_DESCRIPTOR.bootstrap.initialPeers), {
  changed: false, peers: result.peers,
});
assert.deepEqual(mergeBootstrapPeerList(undefined, ['185.207.104.78:24892']), {
  changed: true, peers: ['185.207.104.78:24892'],
});
assert.deepEqual(mergeBootstrapPeerList([custom], ['146.103.42.59:24894', chain, data]), {
  changed: false, peers: [custom],
});
for (const peers of [QORTIUM_CORE_DESCRIPTOR.bootstrap.initialPeers, QORTIUM_CORE_DESCRIPTOR.bootstrap.initialDataPeers]) {
  assert.equal(peers.some(peer => peer.includes('146.103.42.59') || peer.includes(chain) || peer.includes(data)), false);
}
console.log('Managed Qortium bootstrap retirement and preservation checks passed.');
