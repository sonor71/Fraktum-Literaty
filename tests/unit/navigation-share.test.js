import test from 'node:test';
import assert from 'node:assert/strict';
import {routeFromLocation,routeUrl,transitionPage} from '../../src/navigation/Navigation.js';
import {postPermalink,sharePost} from '../../src/navigation/SharePost.js';

const uuid='a3333333-3333-4333-8333-333333333333';
const post={cloud:true,cloudId:uuid,author:'Автор',text:'Текст поста'};

test('post routes and navigation hashes round-trip without accepting arbitrary pages',()=>{
  assert.deepEqual(routeFromLocation({pathname:`/post/${uuid}`,hash:''}),{page:'post',postId:uuid});
  assert.equal(routeUrl({page:'post',postId:uuid}),`/post/${uuid}`);
  assert.deepEqual(routeFromLocation({pathname:'/',hash:'#/profile'}),{page:'profile'});
  assert.deepEqual(routeFromLocation({pathname:'/',hash:'#/unregistered'}),{page:'home'});
  assert.deepEqual(routeFromLocation({pathname:'/post/invalid',hash:''}),{page:'post',postId:null});
  assert.equal(routeUrl({page:'unregistered'}),'/#/home');
});

test('sharing uses Web Share when supported and preserves the canonical permalink',async()=>{
  let payload,clipboard=false;
  assert.equal(await sharePost(post,{origin:'https://literature.test',navigator:{share:async value=>{payload=value;},clipboard:{writeText:async()=>{clipboard=true;}}}}),'shared');
  assert.equal(payload.url,`https://literature.test/post/${uuid}`);
  assert.equal(payload.text,'Текст поста');assert.equal(clipboard,false);
});

test('sharing copies to clipboard when Web Share is unavailable',async()=>{
  let copied;
  assert.equal(await sharePost(post,{origin:'https://literature.test',navigator:{clipboard:{writeText:async value=>{copied=value;}}}}),'copied');
  assert.equal(copied,postPermalink(post,'https://literature.test'));
});

test('sharing distinguishes user cancellation from permissions and clipboard failures',async()=>{
  const cancelled=Object.assign(new Error('cancelled'),{name:'AbortError'});
  assert.equal(await sharePost(post,{origin:'https://literature.test',navigator:{share:async()=>{throw cancelled;}}}),'cancelled');
  await assert.rejects(sharePost(post,{origin:'https://literature.test',navigator:{share:async()=>{throw new Error('permission denied');}}}),/permission denied/);
  await assert.rejects(sharePost(post,{origin:'https://literature.test',navigator:{clipboard:{writeText:async()=>{throw new Error('clipboard denied');}}}}),/clipboard denied/);
  await assert.rejects(sharePost(post,{origin:'https://literature.test',navigator:{}}),/HTTPS/);
  assert.throws(()=>postPermalink({id:'local-post'},'https://literature.test'),/облачной ссылки/);
});

test('navigation uses View Transitions, fallback page animation, and reduced-motion preference',async()=>{
  let rendered=0,transitioned=0,animated=0;
  const doc={startViewTransition(callback){transitioned++;callback();return {updateCallbackDone:Promise.resolve(),finished:Promise.resolve(),ready:Promise.resolve()};}};
  await transitionPage(()=>rendered++,{document:doc});assert.equal(transitioned,1);assert.equal(rendered,1);
  await transitionPage(()=>rendered++,{document:doc,reducedMotion:true});assert.equal(transitioned,1);assert.equal(rendered,2);
  const fallback={querySelector:()=>({classList:{add:value=>{assert.equal(value,'navigation-enter');animated++;}},addEventListener:()=>{}})};
  await transitionPage(()=>rendered++,{document:fallback});assert.equal(animated,1);assert.equal(rendered,3);
});

test('View Transition rendering failures remain observable',async()=>{
  const failure=new Error('render failed');
  const doc={startViewTransition(){return {updateCallbackDone:Promise.reject(failure)};}};
  await assert.rejects(transitionPage(()=>{},{document:doc}),/render failed/);
});
