import assert from 'node:assert/strict';
import { getPollOptionsInput } from './qdn-poll-options-input.js';

assert.deepEqual(getPollOptionsInput(['Yes', { optionName: 'No' }]), [
  { optionName: 'Yes' },
  { optionName: 'No' },
]);
assert.deepEqual(getPollOptionsInput([' ', 'A', 'A ']), [
  { optionName: ' ' },
  { optionName: 'A' },
  { optionName: 'A ' },
]);
assert.deepEqual(getPollOptionsInput('Yes, No'), [
  { optionName: 'Yes' },
  { optionName: 'No' },
]);
assert.throws(() => getPollOptionsInput(['', 'No']), /1 to 400 UTF-8 bytes/);
assert.throws(() => getPollOptionsInput(['A', 'A']), /must be unique/);
assert.throws(() => getPollOptionsInput(['A', 2]), /must be a string/);

console.log('QDN poll option input tests passed.');
