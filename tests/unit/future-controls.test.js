import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = {getItem: () => null};
const {state} = await import('../../src/state.js');
const pages = await import('../../src/pages.js');
state.user = {id:'reader',role:'reader',xp:0};

test('unimplemented community mutations and tabs are explicitly unavailable', () => {
  state.communities = [{id:'old-local',name:'Local record',description:'Old data',type:'Читатели',privacy:'public',members:1}];
  state.ui.selectedCommunityId = 'old-local';
  const list = pages.communitiesPage(), detail = pages.communityDetail();
  assert.match(list, /на этом устройстве/);
  assert.match(list, /<button[^>]*disabled[^>]*>Создать · Скоро/);
  assert.doesNotMatch(list + detail, /data-action="(?:create|join)-community"/);
  assert.match(detail, /<button disabled>Обсуждения · Скоро/);
  assert.equal(state.communities[0].members, 1);
});
