import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
globalThis.__FRAKTUM_CONFIG__={VITE_SUPABASE_URL:'https://project.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
const uuid='a3333333-3333-4333-8333-333333333333';

test('permalink reads an exact cloud post independently of feed pagination',async()=>{
  const requests=[];
  globalThis.fetch=async url=>{
    const parsed=new URL(url);requests.push(parsed);
    const result=parsed.pathname.endsWith('/lit_posts')?[{id:uuid,author_id:'author',body:'Старый пост',created_at:'2025-01-01T12:00:00Z'}]:parsed.pathname.endsWith('/lit_profiles')?[{id:'author',nickname:'Имя',username:'name'}]:[];
    return new Response(JSON.stringify(result),{status:200});
  };
  const {fetchCloudPost}=await import(`../../src/cloud.js?permalink=${Date.now()}`);
  const post=await fetchCloudPost(uuid);
  assert.equal(post.cloudId,uuid);assert.equal(post.text,'Старый пост');assert.equal(post.author,'Имя');
  assert.equal(requests[0].searchParams.get('id'),`eq.${uuid}`);
  assert.equal(requests[0].searchParams.get('visibility'),'eq.public');
  assert.equal(requests[0].searchParams.get('limit'),'1');
  assert.equal(requests.some(url=>url.searchParams.get('limit')==='50'),false);
});

test('deleted or inaccessible permalink reports missing instead of unrelated feed entry',async()=>{
  globalThis.fetch=async()=>new Response('[]',{status:200});
  const {fetchCloudPost}=await import(`../../src/cloud.js?missingPost=${Date.now()}`);
  assert.equal(await fetchCloudPost(uuid),null);
  await assert.rejects(fetchCloudPost('invalid&select=*'),/Некорректная ссылка/);
});

test('permalink surfaces backend authorization errors',async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify({message:'access denied'}),{status:403});
  const {fetchCloudPost}=await import(`../../src/cloud.js?deniedPost=${Date.now()}`);
  await assert.rejects(fetchCloudPost(uuid),/403.*access denied/);
});
