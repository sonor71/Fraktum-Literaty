import test from 'node:test';
import assert from 'node:assert/strict';

const me='10000000-0000-4000-8000-000000000001';
const auth={access_token:'test-session',expires_at:4_000_000_000,user:{id:me}};
globalThis.localStorage={getItem:()=>JSON.stringify(auth),setItem(){},removeItem(){}};
globalThis.__FRAKTUM_CONFIG__={VITE_SUPABASE_URL:'https://profile.test.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'publishable-test'};
const {uploadProfileMedia,removeProfileMedia,updateMyProfile,saveMyProfile}=await import('../../src/cloud.js');
const image=()=>new File(['webp-fixture'],'image.webp',{type:'image/webp'});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});

test('profile replacement uploads an immutable URL, switches the pointer and then deletes the previous asset',async()=>{
  const requests=[];let path=`${me}/avatar.webp`;
  globalThis.fetch=async(url,options={})=>{
    const request={url:String(url),...options};requests.push(request);
    if(request.method==='PATCH'){path=JSON.parse(options.body).avatar_path;return response([{id:me,avatar_path:path}]);}
    if(request.method==='POST'||request.method==='DELETE')return response({});
    return response([{id:me,avatar_path:path}]);
  };
  const first=await uploadProfileMedia('avatar',image()),second=await uploadProfileMedia('avatar',image());
  assert.match(first.path,new RegExp(`^${me}/avatar/[a-f0-9-]+\\.webp$`));
  assert.notEqual(first.path,second.path);
  assert.ok(first.url.endsWith(first.path));
  assert.deepEqual(requests.slice(0,4).map(request=>request.method||'GET'),['GET','POST','PATCH','DELETE']);
  assert.equal(requests[1].headers['x-upsert'],'false');
  assert.deepEqual(JSON.parse(requests[3].body),{prefixes:[`${me}/avatar.webp`]});
  assert.deepEqual(JSON.parse(requests[7].body),{prefixes:[first.path]});
});

test('a denied profile patch removes the new asset and preserves the previous pointer',async()=>{
  const requests=[];
  globalThis.fetch=async(url,options={})=>{
    requests.push({url:String(url),...options});
    if(options.method==='PATCH')return response({message:'permission denied'},403);
    if(options.method==='POST'||options.method==='DELETE')return response({});
    return response([{id:me,banner_path:`${me}/old.webp`}]);
  };
  await assert.rejects(uploadProfileMedia('banner',image()),/403: permission denied/);
  assert.deepEqual(requests.map(request=>request.method||'GET'),['GET','POST','PATCH','DELETE']);
  const uploadedPath=requests[1].url.split('/lit-profile-banners/')[1];
  assert.deepEqual(JSON.parse(requests[3].body),{prefixes:[uploadedPath]});
  assert.notEqual(uploadedPath,`${me}/old.webp`);
});

test('failed storage upload never changes the profile pointer',async()=>{
  const methods=[];
  globalThis.fetch=async(url,options={})=>{methods.push(options.method||'GET');return options.method==='POST'?response({message:'bucket access denied'},403):response([{id:me,avatar_path:'old.webp'}]);};
  await assert.rejects(uploadProfileMedia('avatar',image()),/403: bucket access denied/);
  assert.deepEqual(methods,['GET','POST']);
});

test('media removal clears the profile first and reports a failed file cleanup explicitly',async()=>{
  const requests=[];
  globalThis.fetch=async(url,options={})=>{
    requests.push({url:String(url),...options});
    if(options.method==='PATCH')return response([{id:me,banner_path:null}]);
    if(options.method==='DELETE')return response({message:'storage unavailable'},503);
    return response([{id:me,banner_path:`${me}/banner/old.webp`}]);
  };
  const result=await removeProfileMedia('banner');
  assert.deepEqual(JSON.parse(requests[1].body),{banner_path:null});
  assert.equal(result.path,'');assert.equal(result.url,'');assert.match(result.cleanupWarning,/503: storage unavailable/);
});

test('empty patch responses and unsafe profile fields cannot be reported as successful updates',async()=>{
  let requests=0;globalThis.fetch=async()=>{requests++;return response([]);};
  await assert.rejects(updateMyProfile({author_verified:true}),/Недопустимое поле/);
  assert.equal(requests,0);
  await assert.rejects(updateMyProfile({bio:''}),/не обновлён/);
  assert.equal(requests,1);
  await assert.rejects(uploadProfileMedia('unexpected',image()),/Неизвестный тип/);
  assert.equal(requests,1);
});

test('full profile edits use one transactional RPC instead of independent writes',async()=>{
  let request;globalThis.fetch=async(url,options)=>{request={url:String(url),...options};return response({id:me});};
  const profile={nickname:'Reader',username:'reader',bio:''},preferences={wantedGenres:[1],unwantedGenres:[],wantedTopics:[],unwantedTopics:[]};
  await saveMyProfile({profile,favoriteBooks:[],socialLinks:[],preferences});
  assert.match(request.url,/\/rpc\/lit_save_my_profile$/);
  assert.deepEqual(JSON.parse(request.body),{p_profile:profile,p_details:{favoriteBooks:[],socialLinks:[],preferences}});
});
