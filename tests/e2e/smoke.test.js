import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
let server;
test.before(async()=>{server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'5199',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_e2e_test'},stdio:'ignore'});for(let i=0;i<30;i++){try{if((await fetch('http://127.0.0.1:5199/')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw new Error('application did not start');});
test.after(()=>server?.kill());
test('application serves onboarding shell and editor modules',async()=>{
 const html=await (await fetch('http://127.0.0.1:5199/')).text();assert.match(html,/id="app"/);assert.match(html,/src="\/src\/app\.js"/);
 for(const path of ['/src/app.js','/src/pages.js','/src/editor/EditorRoot.js','/src/editor/HistoryManager.js','/src/editor/AssetService.js','/src/profile/ProfileView.js','/src/evaluation/EvaluationService.js','/src/feedback/FeedbackView.js'])assert.equal((await fetch(`http://127.0.0.1:5199${path}`)).status,200);
});
test('runtime configuration is executable JavaScript and static files win over the SPA fallback',async()=>{
 const runtime=await (await fetch('http://127.0.0.1:5199/runtime-config.js')).text();
 assert.match(runtime,/globalThis\.__FRAKTUM_CONFIG__/);assert.match(runtime,/sb_publishable_e2e_test/);
 assert.doesNotMatch(runtime,/<!doctype html>/i);
 assert.match(await (await fetch('http://127.0.0.1:5199/not-a-real-route')).text(),/id="app"/);
});
test('major navigation and editor actions are registered without missing functions',async()=>{
 const app=await (await fetch('http://127.0.0.1:5199/src/app.js')).text();const pages=await (await fetch('http://127.0.0.1:5199/src/pages.js')).text();
 for(const page of ['home','read','evaluate','library','create','communities','messages','profile','admin','reader','feedback'])assert.match(app,new RegExp(`${page}:pages\\.`));
 for(const action of ['canvas-add-text','insert-canvas-media','canvas-delete','preview-work','open-community'])assert.match(app,new RegExp(`action==='${action}'`));
 assert.doesNotMatch(pages,/onclick\s*=/);
});
test('development server keeps checkout internals private and returns useful static URL errors',async()=>{
 for(const path of ['/.git/config','/.env','/package.json','/src/..%2f..%2f.git/config','/src/missing-module.js','/assets/missing-image.png']){
   const response=await fetch(`http://127.0.0.1:5199${path}`);
   assert.equal(response.status,404,`${path} must not serve checkout internals or the SPA fallback`);
 }
 assert.equal((await fetch('http://127.0.0.1:5199/%E0%A4%A')).status,400);
 assert.equal((await fetch('http://127.0.0.1:5199/')).status,200,'invalid URL must not crash the server');
 assert.match((await fetch('http://127.0.0.1:5199/runtime-config.js')).headers.get('cache-control'),/no-store/);
});
