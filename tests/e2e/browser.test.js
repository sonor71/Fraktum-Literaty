import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserHarness,createBackendFixture,BACKEND_ORIGIN,POST_ID,PROFILE} from './browser-harness.js';

let harness;
test.before(async()=>{harness=await createBrowserHarness();});
test.after(async()=>{await harness?.close();});

function assertClean({errors,fixture}){
  assert.deepEqual(errors,[],'unexpected browser console/runtime errors');
  assert.deepEqual(fixture.failures,[],'unexpected HTTP fixture endpoints');
}

async function navigate(page,name){
  if(name==='profile')await page.locator('.avatar-btn').click();
  else{
    const menu=page.locator('.menu-toggle');
    if(await menu.isVisible())await menu.click();
    await page.locator(`.sidebar nav [data-page="${name}"]`).click();
  }
  await page.waitForFunction(name=>location.hash===`#/${name}`,name);
  await page.waitForSelector('.page');
}

test('browser executes registration, OTP, session restore and logout against HTTP fixtures',async t=>{
  const fixture=createBackendFixture({profile:{...PROFILE,account_role:'reader',author_verified:false}});
  fixture.tables.lit_profiles=[];
  const scenario=await harness.scenario(t,{authenticated:false,fixture});
  const {page}=scenario;
  await page.locator('[data-action="choose-role"][data-role="reader"]').click();
  for(const [name,value] of Object.entries({nickname:'New Reader',username:'new-reader',firstName:'New',lastName:'Reader',identifier:'new-reader@example.test'}))await page.locator(`#registrationOtpRequestForm [name="${name}"]`).fill(value);
  await page.locator('#registrationOtpRequestForm button[type="submit"]').click();
  await page.locator('#otpVerifyForm [name="token"]').fill('123456');
  await page.locator('#otpVerifyForm button[type="submit"]').click();
  await page.waitForSelector('.app-shell');
  assert.ok(fixture.requests.some(request=>request.pathname==='/auth/v1/otp'&&request.body.create_user===true));
  assert.ok(fixture.requests.some(request=>request.pathname==='/auth/v1/verify'&&request.body.token==='123456'));
  assert.ok(fixture.tables.lit_profiles.some(profile=>profile.username==='new-reader'));
  await page.reload();
  await page.waitForSelector('.app-shell');
  await page.locator('[data-action="cloud-logout"]').click();
  await page.waitForSelector('#loginOtpRequestForm');
  assert.equal(await page.evaluate(()=>localStorage.getItem('d20-supabase-session-v1')),null);
  await page.reload();
  await page.waitForSelector('.onboard-card');
  assert.equal(await page.locator('.app-shell').count(),0);
  assertClean(scenario);
});

test('login submits OTP and restores a real rendered profile with a fixture session',async t=>{
  const scenario=await harness.scenario(t,{authenticated:false});
  const {page,fixture}=scenario;
  await page.locator('[data-action="show-login"]').click();
  await page.locator('#loginOtpRequestForm [name="identifier"]').fill('regression@example.test');
  await page.locator('#loginOtpRequestForm button[type="submit"]').click();
  await page.locator('#otpVerifyForm [name="token"]').fill('123456');
  await page.locator('#otpVerifyForm button[type="submit"]').click();
  await page.waitForSelector('.app-shell');
  assert.ok(fixture.requests.some(request=>request.pathname==='/auth/v1/otp'&&request.body.create_user===false));
  await navigate(page,'profile');
  assert.match(await page.locator('.page').innerText(),/Regression Author/);
  assertClean(scenario);
});

test('async auth failure shows feedback, disables the pressed control and preserves typed fields',async t=>{
  const scenario=await harness.scenario(t,{authenticated:false});
  const {page,context}=scenario;
  let completeRequest;
  const pending=new Promise(resolve=>{completeRequest=resolve;});
  await context.route(`${BACKEND_ORIGIN}/auth/v1/otp`,async route=>{
    await pending;
    await route.fulfill({status:429,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({message:'OTP rate limit regression'})});
  });
  await page.locator('[data-action="show-login"]').click();
  const identifier=page.locator('#loginOtpRequestForm [name="identifier"]');
  await identifier.fill('keep-this@example.test');
  const submit=page.locator('#loginOtpRequestForm button[type="submit"]');
  await submit.click();
  assert.equal(await submit.getAttribute('aria-busy'),'true');
  assert.equal(await submit.isDisabled(),true);
  completeRequest();
  await page.waitForSelector('#operationFeedback');
  assert.match(await page.locator('#operationFeedback').innerText(),/OTP rate limit regression/);
  assert.equal(await identifier.inputValue(),'keep-this@example.test');
  await page.waitForFunction(()=>!document.querySelector('#loginOtpRequestForm button[type="submit"]').disabled);
  assert.equal(await submit.getAttribute('aria-busy'),null);
  assert.deepEqual(scenario.fixture.failures,[]);
  assert.ok(scenario.errors.every(error=>error.includes('429')),'only the deliberately injected HTTP error is expected');
});

test('share copies a canonical permalink and that URL reloads the requested cloud post',async t=>{
  const scenario=await harness.scenario(t);
  const {page}=scenario;
  await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:undefined}));
  await page.locator(`[data-action="share-post"][data-id="cloud:${POST_ID}"]`).click();
  await page.waitForSelector('.toast');
  assert.match(await page.locator('.toast').innerText(),/Ссылка скопирована/);
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  assert.equal(copied,`${harness.baseURL}/post/${POST_ID}`);
  await page.goto(copied);
  await page.waitForSelector(`.post[data-post-id="${POST_ID}"]`);
  assert.match(await page.locator('.post').innerText(),/Проверка стабильной ссылки/);
  await page.reload();
  await page.waitForSelector(`.post[data-post-id="${POST_ID}"]`);
  assertClean(scenario);
});

test('share uses the native API when the browser provides it',async t=>{
  const scenario=await harness.scenario(t);
  const {page}=scenario;
  await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{globalThis.__sharedPost=data;}}));
  await page.locator(`[data-action="share-post"][data-id="cloud:${POST_ID}"]`).click();
  await page.waitForFunction(()=>Boolean(globalThis.__sharedPost));
  assert.equal(await page.evaluate(()=>globalThis.__sharedPost.url),`${harness.baseURL}/post/${POST_ID}`);
  assertClean(scenario);
});

test('a post permalink survives OTP login and an unknown post shows an explicit unavailable state',async t=>{
  const scenario=await harness.scenario(t,{authenticated:false,path:`/post/${POST_ID}`});
  const {page}=scenario;
  await page.locator('[data-action="show-login"]').click();
  await page.locator('#loginOtpRequestForm [name="identifier"]').fill('regression@example.test');
  await page.locator('#loginOtpRequestForm button[type="submit"]').click();
  await page.locator('#otpVerifyForm [name="token"]').fill('123456');
  await page.locator('#otpVerifyForm button[type="submit"]').click();
  await page.waitForSelector(`.permalink-post .post[data-post-id="${POST_ID}"]`);
  assert.equal(new URL(page.url()).pathname,`/post/${POST_ID}`);
  await page.goto(`${harness.baseURL}/post/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`);
  await page.waitForSelector('.permalink-post .empty');
  assert.match(await page.locator('.permalink-post').innerText(),/Пост недоступен/);
  assertClean(scenario);
});

for(const width of [360,390,430,1366,1920]){
  test(`navigation and drawer keep their controls usable at ${width}px`,async t=>{
    const scenario=await harness.scenario(t,{viewport:{width,height:900}});
    const {page}=scenario;
    const toggle=page.locator('.chat-edge-toggle');
    await toggle.click();
    await page.waitForFunction(()=>document.querySelector('.chat-shell').classList.contains('is-open'));
    assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('#chat-drawer').getAttribute('inert'),null);
    const edge=await toggle.boundingBox(),drawer=await page.locator('#chat-drawer').boundingBox();
    assert.ok(Math.abs(edge.x+edge.width-drawer.x)<1,'toggle is physically attached to drawer edge');
    assert.ok(edge.x>=-1&&edge.x+edge.width<=width+1,'toggle stays within viewport');
    assert.ok(drawer.x>=edge.width-1,'drawer leaves room for its toggle');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    assert.notEqual(await page.locator('#chat-drawer').getAttribute('inert'),null);
    for(const name of ['evaluate','read','library','create','feedback','messages','home','profile'])await navigate(page,name);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    assert.ok(overflow<=1,`unexpected horizontal overflow: ${overflow}px`);
    await page.goBack();
    await page.waitForFunction(()=>location.hash==='#/home');
    await page.goForward();
    await page.waitForFunction(()=>location.hash==='#/profile');
    assertClean(scenario);
  });
}

test('CSS navigation fallback works without View Transitions API',async t=>{
  const scenario=await harness.scenario(t,{reducedMotion:'no-preference'});
  const {page}=scenario;
  await page.evaluate(()=>Object.defineProperty(document,'startViewTransition',{configurable:true,value:undefined}));
  await navigate(page,'read');
  await page.waitForFunction(()=>!document.querySelector('.page')?.classList.contains('page-entering'));
  assert.equal(await page.locator('.sidebar [data-page="read"]').evaluate(button=>button.classList.contains('active')),true);
  assert.equal(await page.evaluate(()=>window.scrollY),0);
  assertClean(scenario);
});

test('manifest and icon responses have the advertised browser MIME and dimensions',async t=>{
  const scenario=await harness.scenario(t,{authenticated:false});
  const {page}=scenario;
  const manifest=await page.request.get(`${harness.baseURL}/manifest.webmanifest`);
  assert.match(manifest.headers()['content-type'],/application\/manifest\+json/);
  for(const icon of (await manifest.json()).icons){
    const dimensions=await page.evaluate(async src=>{
      const image=new Image();image.src=src;await image.decode();
      return `${image.naturalWidth}x${image.naturalHeight}`;
    },icon.src);
    assert.equal(dimensions,icon.sizes);
  }
  assertClean(scenario);
});
