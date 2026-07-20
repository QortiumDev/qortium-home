import assert from 'node:assert/strict';
import { getQdnAppTargetQuery, isSameQdnAppRoute } from './qdn-app-target.js';
import { parseAppAddress } from './routes.js';

function route(address: string) {
  const parsed = parseAppAddress(address);

  if (!parsed.success) {
    throw new Error(`Test route failed to parse: ${address}`);
  }

  return parsed.route;
}

const chat = route('qdn://APP/Chat/Chat?address=Qsender');
const sameChat = route('qdn://APP/Chat/Chat?group=42');
const differentApp = route('qdn://APP/Names/Names');
const differentIdentifier = route('qdn://APP/Chat/Other');
const differentPath = route('qdn://APP/Chat/Chat/page-two');
const samePathWithOtherTarget = route('qdn://APP/Chat/Chat?view=unread&group=77');
const samePathWithAddress = route('qdn://APP/Chat/Chat?view=unread&address=Qsender');
const settings = route('home://settings');

assert.equal(isSameQdnAppRoute(chat, sameChat), true);
assert.equal(isSameQdnAppRoute(chat, differentApp), false);
assert.equal(isSameQdnAppRoute(chat, differentIdentifier), false);
assert.equal(isSameQdnAppRoute(chat, differentPath), false);
assert.equal(isSameQdnAppRoute(samePathWithOtherTarget, samePathWithAddress), true);
assert.equal(isSameQdnAppRoute(chat, settings), false);
assert.deepEqual(getQdnAppTargetQuery(chat), { address: 'Qsender' });
assert.deepEqual(getQdnAppTargetQuery(sameChat), { group: '42' });
assert.equal(getQdnAppTargetQuery(differentApp), null);

// A non-target parameter still participates in identity, even for a registered
// app: two Chat routes filtered differently remain different routes.
assert.equal(
  isSameQdnAppRoute(route('qdn://APP/Chat/Chat?view=unread'), route('qdn://APP/Chat/Chat?view=all')),
  false,
);

// Recipes: the recipe target is app state, so a link matches the open tab.
const recipesBrowse = route('qdn://APP/Recipes/Recipes');
const recipeOne = route('qdn://APP/Recipes/Recipes?recipe=qrecipes.v1.r.one&author=Alice');
const recipeTwo = route('qdn://APP/Recipes/Recipes?recipe=qrecipes.v1.r.two&author=Bob');

assert.equal(isSameQdnAppRoute(recipesBrowse, recipeOne), true);
assert.equal(isSameQdnAppRoute(recipeOne, recipeTwo), true);
assert.deepEqual(getQdnAppTargetQuery(recipeOne), {
  recipe: 'qrecipes.v1.r.one',
  author: 'Alice',
});
assert.equal(getQdnAppTargetQuery(recipesBrowse), null);

// Regression guard: apps that deep-link but do NOT handle OPEN_APP_TARGET must
// keep producing a new tab, or their links would silently do nothing. Help and
// boards both use `?post=<id>`.
const helpBrowse = route('qdn://APP/Help/Help');
const helpPost = route('qdn://APP/Help/Help?post=abc');
const boardsPost = route('qdn://APP/Boards/Boards?post=abc');

assert.equal(isSameQdnAppRoute(helpBrowse, helpPost), false);
assert.equal(getQdnAppTargetQuery(helpPost), null);
assert.equal(isSameQdnAppRoute(route('qdn://APP/Boards/Boards'), boardsPost), false);
assert.equal(getQdnAppTargetQuery(boardsPost), null);

// An unregistered app carrying a registered app's parameter name is not special.
const namesWithAddress = route('qdn://APP/Names/Names?address=Qsender');
assert.equal(isSameQdnAppRoute(differentApp, namesWithAddress), false);
assert.equal(getQdnAppTargetQuery(namesWithAddress), null);

// Blank target values are dropped rather than forwarded as empty strings.
assert.equal(getQdnAppTargetQuery(route('qdn://APP/Chat/Chat?address=%20')), null);

console.log('QDN app target tests passed.');
