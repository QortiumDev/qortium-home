import assert from 'node:assert/strict'
import {
  I2PD_SAM_MAX_REPLY_BYTES,
  isValidI2pdSamHelloReplyLine,
} from './i2pd-sam-protocol.js'

for (const reply of [
  'HELLO REPLY RESULT=OK VERSION=3.0',
  'HELLO REPLY RESULT=OK VERSION=3.1',
  'HELLO REPLY RESULT=OK VERSION=3.2',
  'HELLO REPLY RESULT=OK VERSION=3.3\r',
]) {
  assert.equal(isValidI2pdSamHelloReplyLine(Buffer.from(reply, 'ascii')), true)
}
for (const reply of [
  '',
  'HELLO REPLY RESULT=OK',
  'HELLO REPLY RESULT=OK VERSION=2.0',
  'HELLO REPLY RESULT=OK VERSION=3.4',
  'HELLO REPLY RESULT=I2P_ERROR VERSION=3.3',
  'HELLO REPLY VERSION=3.3 RESULT=OK',
  'HELLO REPLY RESULT=OK VERSION=3.3 EXTRA=value',
  'HELLO REPLY RESULT=OK VERSION=3.3\nsecond line',
  'HELLO REPLY RESULT=OK VERSION=3.3\u0000',
]) {
  assert.equal(isValidI2pdSamHelloReplyLine(Buffer.from(reply, 'utf8')), false)
}
assert.equal(
  isValidI2pdSamHelloReplyLine(Buffer.alloc(I2PD_SAM_MAX_REPLY_BYTES + 1, 0x41)),
  false,
)

console.log('i2pd SAM protocol tests passed.')
