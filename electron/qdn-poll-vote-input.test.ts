import assert from 'node:assert/strict';
import {
  getOptionalPollVoteOptionIndexes,
  getPollVoteApprovalName,
  resolvePollVoteOptionInput,
} from './qdn-poll-vote-input.js';

const getInteger = (value: unknown) => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
};

assert.deepEqual(resolvePollVoteOptionInput(2, undefined), { optionIndex: 2 });
assert.deepEqual(
  resolvePollVoteOptionInput(undefined, getOptionalPollVoteOptionIndexes([1, 3], getInteger)),
  { optionIndexes: [1, 3] },
);
assert.deepEqual(
  resolvePollVoteOptionInput(undefined, getOptionalPollVoteOptionIndexes([], getInteger)),
  { optionIndexes: [] },
);
assert.deepEqual(
  resolvePollVoteOptionInput(undefined, getOptionalPollVoteOptionIndexes([0], getInteger)),
  { optionIndexes: [0] },
);
assert.deepEqual(
  resolvePollVoteOptionInput(3, getOptionalPollVoteOptionIndexes([3], getInteger)),
  { optionIndexes: [3] },
);
assert.deepEqual(
  resolvePollVoteOptionInput(0, getOptionalPollVoteOptionIndexes([], getInteger)),
  { optionIndexes: [] },
);
assert.throws(
  () => resolvePollVoteOptionInput(2, getOptionalPollVoteOptionIndexes([1, 3], getInteger)),
  /optionIndex conflicts with optionIndexes/,
);
assert.throws(() => getOptionalPollVoteOptionIndexes([1.5], getInteger), /safe integers/);
assert.throws(() => getOptionalPollVoteOptionIndexes([-1], getInteger), /at least 0/);
assert.throws(() => resolvePollVoteOptionInput(undefined, undefined), /Option index is required/);
assert.equal(getPollVoteApprovalName(7, { optionIndexes: [3, 1] }), 'Poll #7 · options 1, 3');
assert.equal(getPollVoteApprovalName(7, { optionIndexes: [] }), 'Poll #7 · remove vote');
assert.equal(getPollVoteApprovalName(7, { optionIndexes: [0] }), 'Poll #7 · remove vote');

console.log('QDN poll vote input tests passed.');
