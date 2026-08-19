import assert from 'node:assert/strict'
import {
  homeV2NotificationSourceKey,
  isHomeV2NotificationAction,
  normalizeHomeV2NotificationRequest,
} from './home-v2-notification-contract.js'

assert.equal(isHomeV2NotificationAction('SHOW_NOTIFICATION'), true)
assert.equal(isHomeV2NotificationAction('NOTIFICATION_HAS_PERMISSION'), true)
assert.equal(isHomeV2NotificationAction('NOTIFICATION_ADD'), false)

const qortium = normalizeHomeV2NotificationRequest('qdnRequest', {
  title: ' New\u202e message ',
  text: 'Alice\nmentioned\tyou',
  network: 'qortium',
  source: { kind: 'chat', conversation: { kind: 'group', groupId: 12 } },
})
assert.deepEqual(qortium, {
  network: 'qortium',
  source: { kind: 'chat', conversation: { kind: 'group', groupId: 12 } },
  text: 'Alice mentioned you',
  title: 'New message',
})
assert.equal(homeV2NotificationSourceKey(qortium.source), 'chat:group:12')

const qortal = normalizeHomeV2NotificationRequest('qortalRequest', {
  title: 'Direct message',
  source: { kind: 'chat', conversation: { kind: 'direct', otherAddress: 'Qaaaaaaaaaaaaaaaaaaaa' } },
})
assert.equal(qortal.network, 'qortal')
assert.equal(qortal.text, '')
assert.equal(homeV2NotificationSourceKey(qortal.source), 'chat:direct:Qaaaaaaaaaaaaaaaaaaaa')

assert.throws(
  () => normalizeHomeV2NotificationRequest('qdnRequest', { title: 'Wrong chain', network: 'qortal' }),
  /must match qdnRequest/,
)
assert.throws(
  () => normalizeHomeV2NotificationRequest('qdnRequest', {
    title: 'Bad group',
    source: { kind: 'chat', conversation: { kind: 'group', groupId: -1 } },
  }),
  /non-negative safe integer/,
)
assert.throws(
  () => normalizeHomeV2NotificationRequest('qdnRequest', { title: 'x'.repeat(81) }),
  /too long/,
)
assert.throws(
  () => normalizeHomeV2NotificationRequest('qortalRequest', {
    title: 'Bad direct',
    source: { kind: 'chat', conversation: { kind: 'direct', otherAddress: 'not-an-address' } },
  }),
  /direct address is invalid/,
)

console.log('Home v2 notification contract tests passed')
