import test from 'node:test';
import assert from 'node:assert/strict';
import {cover} from '../../src/ui.js';

test('cover metadata cannot break out of quoted image attributes',()=>{
  const html=cover({cover:'/image.png" onerror="untrusted()'},'big" data-bad="x');
  assert.ok(html.includes('src="/image.png&quot; onerror=&quot;untrusted()'));
  assert.doesNotMatch(html,/ onerror="| data-bad="/);
  assert.match(html,/class="cover big&quot;/);
});
