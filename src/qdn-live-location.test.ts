import assert from 'node:assert/strict';
import { getLiveQdnDisplayUrl } from './qdn-live-location.js';

assert.equal(
  getLiveQdnDisplayUrl(
    'qdn://APP/Polls/Polls/41',
    'http://127.0.0.1:12391/render/APP/Polls/Polls/73',
  ),
  'qdn://APP/Polls/Polls/73',
);

assert.equal(
  getLiveQdnDisplayUrl(
    'qdn://APP/Boards/Boards/?thread=old',
    'http://127.0.0.1:12391/render/APP/Boards/Boards?thread=new&post=reply&theme=dark&lang=en',
  ),
  'qdn://APP/Boards/Boards?thread=new&post=reply',
);

assert.equal(
  getLiveQdnDisplayUrl(
    'qdn://APP/Boards/Boards/',
    'http://127.0.0.1:12391/render/APP/Boards/Boards?thread=new#reply-anchor',
  ),
  'qdn://APP/Boards/Boards?thread=new#reply-anchor',
);

assert.equal(
  getLiveQdnDisplayUrl(
    'qdn://APP/Boards/Boards/#old-anchor',
    'http://127.0.0.1:12391/render/APP/Boards/Boards/#new-anchor',
  ),
  'qdn://APP/Boards/Boards/#new-anchor',
);

assert.equal(
  getLiveQdnDisplayUrl(
    'qdn://APP/Example/default/',
    'https://node.example/render/APP/Example/page/two?qdnHomeBridge=secret&view=details',
  ),
  'qdn://APP/Example/default/page/two?view=details',
);

assert.equal(
  getLiveQdnDisplayUrl(
    'qdn://APP/Boards/Boards/',
    'http://127.0.0.1:12391/render/APP/Polls/Polls/73',
  ),
  null,
);

assert.equal(
  getLiveQdnDisplayUrl(
    'qdn://APP/Boards/Boards/',
    'file:///render/APP/Boards/Boards/?thread=forged',
  ),
  null,
);

console.log('QDN live location tests passed.');
