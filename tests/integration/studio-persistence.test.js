import test from 'node:test';
import assert from 'node:assert/strict';
import {createConnection} from '../../src/editor/ConnectionModel.js';

globalThis.__FRAKTUM_CONFIG__={VITE_SUPABASE_URL:'https://studio-fixture.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_studio_fixture'};
globalThis.localStorage={getItem:()=>JSON.stringify({access_token:'test-access',user:{id:'test-author'}}),setItem(){},removeItem(){}};
const {saveCloudWork,saveCloudFragment}=await import('../../src/cloud.js');
function work(mode){
  const canvas={objects:[{id:'a',type:'text',x:0,y:0,w:200,h:100,html:'<p>A</p>'},{id:'b',type:'text',x:300,y:200,w:200,h:100,html:'<p>B</p>'}]};
  createConnection(canvas,'a','b','hypothesis').label='предполагает';
  return {id:'local',title:'Story',content:'Story text',cloudId:'work-id',cloudVersionId:'version-id',editorMode:mode,documentPages:[{id:'doc',canvas:structuredClone(canvas)}],bookPages:[{id:'page',type:'content',canvas:structuredClone(canvas)}]};
}
test('cloud work update and publication serialize connections as structured JSON for both modes',async()=>{
  for(const mode of ['document','book']){
    const requests=[];
    globalThis.fetch=async(url,options)=>{requests.push({url:String(url),options,body:JSON.parse(options.body)});return Response.json([{id:String(url).includes('lit_work_versions')?'version-id':'work-id',version_no:1}]);};
    await saveCloudWork(work(mode),{mode:'published'});
    const version=requests.find(request=>request.url.includes('lit_work_versions'));
    assert.equal(version.options.method,'PATCH');assert.ok(version.body.published_at);
    assert.equal(version.body.content.bookPages[0].canvas.connections[0].label,'предполагает');
    assert.equal(version.body.content.documentPages[0].canvas.connections[0].type,'hypothesis');
    assert.doesNotMatch(JSON.stringify(version.body.content),/<svg|<path/);
  }
});
test('closing fragment evaluation preserves public visibility and structured relationships',async()=>{
  let payload;
  globalThis.fetch=async(url,options)=>{payload=JSON.parse(options.body);return Response.json([{id:'fragment-id',...payload}]);};
  await saveCloudFragment(work('document'),{publish:true,evaluationOpen:false});
  assert.equal(payload.visibility,'public');assert.equal(payload.evaluation_open,false);
  assert.equal(payload.content.documentPages[0].canvas.connections.length,1);
});
