import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage={getItem:()=>null,setItem(){}};
globalThis.__FRAKTUM_CONFIG__={VITE_SUPABASE_URL:'https://profile.test.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'publishable-test'};
const {state}=await import('../../src/state.js');
const {profileView}=await import('../../src/profile/ProfileView.js');

test('completed library books from another author expose reading instead of editing controls',()=>{
  state.user={id:'reader',name:'Reader',username:'reader',role:'reader',xp:0,reputation:0};
  state.ui.profileTab='read';state.library.completed=['foreign-work'];
  state.works=[{id:'foreign-work',authorId:'other',title:'Book',version:'1',writingStatus:'completed'}];
  const html=profileView();
  assert.match(html,/data-action="open-work" data-id="foreign-work"/);
  assert.doesNotMatch(html,/data-action="studio-select"|data-action="analytics"/);
});

test('authors retain editor and analytics controls for their own works',()=>{
  state.user={id:'author',name:'Author',username:'author',role:'author',xp:0,reputation:0};
  state.ui.profileTab='writing';
  state.works=[{id:'own-work',authorId:'author',title:'Draft',version:'1',writingStatus:'draft'}];
  const html=profileView();
  assert.match(html,/data-action="studio-select" data-id="own-work"/);
  assert.match(html,/data-action="analytics" data-id="own-work"/);
});
