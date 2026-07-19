import assert from 'node:assert/strict';
import {
  mergeQdnAppHistory,
  spliceQdnAppHistory,
  type QdnAppHistorySession,
} from './qdn-app-history.js';

const baseEntry = { index: 2, url: 'https://node/render/APP/Polls/Polls/' };
const poll41 = { index: 3, url: 'https://node/render/APP/Polls/Polls/41' };
const poll73 = { index: 4, url: 'https://node/render/APP/Polls/Polls/73' };

const initial = mergeQdnAppHistory({
  activeIndex: 2,
  currentHistoryIndex: 1,
  displayUrls: ['qdn://APP/Polls/Polls/'],
  entries: [baseEntry],
  resourceUrl: 'qdn://APP/Polls/Polls/',
});

assert.ok(initial);
assert.equal(initial.historyIndex, 1);
assert.equal(initial.session.startIndex, 1);
assert.equal(initial.truncateForward, false);

const firstMultiEntrySnapshot = mergeQdnAppHistory({
  activeIndex: 3,
  currentHistoryIndex: 1,
  displayUrls: ['qdn://APP/Polls/Polls/', 'qdn://APP/Polls/Polls/41'],
  entries: [baseEntry, poll41],
  resourceUrl: 'qdn://APP/Polls/Polls/',
});
assert.ok(firstMultiEntrySnapshot);
assert.equal(firstMultiEntrySnapshot.session.startIndex, 1, 'outer pages before the app are preserved');
assert.equal(firstMultiEntrySnapshot.historyIndex, 2);
assert.deepEqual(
  spliceQdnAppHistory({
    currentEntries: ['dashboard', 'polls', 'later-home-page'],
    merge: firstMultiEntrySnapshot,
    nextAppEntries: ['polls', 'poll-41'],
    previousSessionLength: 1,
  }),
  { entries: ['dashboard', 'polls', 'poll-41'], index: 2 },
  'a new app push retains prior pages and truncates outer forward history',
);

const pushed = mergeQdnAppHistory({
  activeIndex: 4,
  currentHistoryIndex: 1,
  displayUrls: [
    'qdn://APP/Polls/Polls/',
    'qdn://APP/Polls/Polls/41',
    'qdn://APP/Polls/Polls/73',
  ],
  entries: [baseEntry, poll41, poll73],
  previous: initial.session,
  resourceUrl: initial.session.resourceUrl,
});

assert.ok(pushed);
assert.equal(pushed.historyIndex, 3);
assert.equal(pushed.truncateForward, true);

const traversed = mergeQdnAppHistory({
  activeIndex: 3,
  currentHistoryIndex: 3,
  displayUrls: pushed.displayUrls,
  entries: pushed.session.entries,
  previous: pushed.session,
  resourceUrl: pushed.session.resourceUrl,
});

assert.ok(traversed);
assert.equal(traversed.historyIndex, 2);
assert.equal(traversed.truncateForward, false);

const replacedEntries = [baseEntry, { index: 3, url: 'https://node/render/APP/Polls/Polls/42' }, poll73];
const replaced = mergeQdnAppHistory({
  activeIndex: 3,
  currentHistoryIndex: 2,
  displayUrls: [
    'qdn://APP/Polls/Polls/',
    'qdn://APP/Polls/Polls/42',
    'qdn://APP/Polls/Polls/73',
  ],
  entries: replacedEntries,
  previous: traversed.session,
  resourceUrl: traversed.session.resourceUrl,
});

assert.ok(replaced);
assert.equal(replaced.truncateForward, false);
assert.deepEqual(
  spliceQdnAppHistory({
    currentEntries: ['dashboard', 'polls', 'poll-41', 'poll-73', 'later-home-page'],
    merge: replaced,
    nextAppEntries: ['polls', 'poll-42', 'poll-73'],
    previousSessionLength: 3,
  }).entries,
  ['dashboard', 'polls', 'poll-42', 'poll-73', 'later-home-page'],
  'replaceState retains the outer forward stack',
);

const duplicateUrlSession: QdnAppHistorySession = {
  ...pushed.session,
  activeIndex: 4,
  displayUrls: ['qdn://APP/Polls/Polls/', 'qdn://APP/Polls/Polls/41', 'qdn://APP/Polls/Polls/41'],
  entries: [baseEntry, poll41, { index: 4, url: poll41.url }],
};
const duplicateTraversal = mergeQdnAppHistory({
  activeIndex: 3,
  currentHistoryIndex: 3,
  displayUrls: duplicateUrlSession.displayUrls,
  entries: duplicateUrlSession.entries,
  previous: duplicateUrlSession,
  resourceUrl: duplicateUrlSession.resourceUrl,
});

assert.ok(duplicateTraversal);
assert.equal(duplicateTraversal.historyIndex, 2, 'engine indexes disambiguate duplicate URLs');

console.log('QDN app history tests passed.');
