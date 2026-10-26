import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConnections,createConnection,removeConnection,reverseConnection,removeDanglingConnections,connectionEndpoints} from '../../src/editor/ConnectionModel.js';
import {renderConnections} from '../../src/editor/ConnectionRenderer.js';
import {normalizePageMedia,serializeWorkContent} from '../../src/editor/MediaModel.js';
import {createEditorRoot} from '../../src/editor/EditorRoot.js';
import {pageHasContent,removeStudioPage} from '../../src/editor/PageNavigation.js';
const objects=()=>[{id:'a',type:'text',x:0,y:0,w:100,h:100,html:'<p>A</p>'},{id:'b',type:'image',x:300,y:0,w:100,h:100,url:'/icons/icon-192.png'}];

test('connections normalize old projects and remove malformed, duplicate and dangling links',()=>{
  assert.deepEqual(normalizePageMedia({id:'old',html:'<p>Old text</p>'}).canvas.connections,[]);
  const canvas={objects:objects()};const link=createConnection(canvas,'a','b');
  assert.throws(()=>createConnection(canvas,'a','a'),/другой объект/);
  assert.throws(()=>createConnection(canvas,'a','b'),/существует/);
  assert.throws(()=>createConnection(canvas,'a','gone'),/больше не/);
  assert.equal(normalizeConnections([link,{...link,id:'duplicate'},null,{...link,toObjectId:'gone'}],canvas.objects).length,1);
  reverseConnection(canvas,link.id);assert.equal(canvas.connections[0].fromObjectId,'b');
  canvas.objects=canvas.objects.slice(0,1);removeDanglingConnections(canvas);assert.deepEqual(canvas.connections,[]);
});
test('anchors intersect rectangle boundaries and respond to move, resize and rotation',()=>{
  const [a,b]=objects();
  assert.deepEqual(connectionEndpoints(a,b),{from:{x:100,y:50},to:{x:300,y:50}});
  const moved=connectionEndpoints(a,{...b,y:300});assert.notDeepEqual(moved,connectionEndpoints(a,b));
  assert.notDeepEqual(connectionEndpoints({...a,w:200},b),connectionEndpoints(a,b));
  const rotated=connectionEndpoints({...a,rotation:45},b);assert.ok(rotated.from.x>100);
  for(const point of Object.values(connectionEndpoints(a,a)))assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));
});
test('relationship operations use the same undo/redo snapshot as object deletion',()=>{
  let canvas={objects:objects(),connections:[]},changes=0;
  const root=createEditorRoot({readSnapshot:()=>canvas,applySnapshot:next=>canvas=next,onChange:()=>changes++});
  root.record('connect',()=>createConnection(canvas,'a','b','dependency'));
  const id=canvas.connections[0].id;
  root.record('reverse',()=>reverseConnection(canvas,id));root.undo();assert.equal(canvas.connections[0].fromObjectId,'a');root.redo();assert.equal(canvas.connections[0].fromObjectId,'b');
  root.record('delete object',()=>{canvas.objects.pop();removeDanglingConnections(canvas);});assert.equal(canvas.connections.length,0);
  root.undo();assert.equal(canvas.objects.length,2);assert.equal(canvas.connections.length,1);
  root.record('delete line',()=>removeConnection(canvas,id));assert.equal(canvas.objects.length,2);assert.equal(canvas.connections.length,0);assert.ok(changes>=6);
});
test('nested photo/body anchors join nearest edges without running backwards through the photo',()=>{
  const photo={x:220,y:220,w:280,h:220},body={x:72,y:72,w:616,h:936};
  const endpoints=connectionEndpoints(photo,body);
  assert.deepEqual(endpoints,{from:{x:220,y:330},to:{x:72,y:330}});
  assert.deepEqual(connectionEndpoints(body,photo),{from:endpoints.to,to:endpoints.from});
});
test('all four styles render semantically distinct paths and escape labels without saving SVG',()=>{
  for(const type of ['cause','relation','dependency','hypothesis']){
    const canvas={objects:objects()};createConnection(canvas,'a','b',type).label='<script>"unsafe"</script>';
    const markup=renderConnections(canvas);assert.doesNotMatch(markup,/<script>/);assert.match(markup,/&lt;script&gt;/);
    assert.equal(markup.includes('marker-end='),['cause','dependency'].includes(type));
    assert.equal(markup.includes('stroke-dasharray='),['dependency','hypothesis'].includes(type));
    assert.doesNotMatch(markup,/data-action=|tabindex=/);
    assert.match(renderConnections(canvas,{editable:true}),/connection-hit/);
    for(const mode of ['document','book']){
      const page={id:'one',canvas:structuredClone(canvas)},work={editorMode:mode,documentPages:[page],bookPages:[page]};
      const content=serializeWorkContent(work);assert.equal(content.bookPages[0].canvas.connections[0].type,type);assert.doesNotMatch(JSON.stringify(content),/<svg/);
    }
  }
});
test('state reload retains book relationships and deletion protects structural pages',async()=>{
  const canvas={objects:objects()};createConnection(canvas,'a','b');
  globalThis.localStorage={getItem:()=>JSON.stringify({works:[{id:'book',editorMode:'book',bookPages:[{id:'p',type:'content',canvas}]}]})};
  const {loadState}=await import('../../src/state.js?connections');assert.equal(loadState().works[0].bookPages[0].canvas.connections.length,1);
  const work={editorMode:'book',bookPages:[{type:'cover'},{type:'title'},{type:'content',canvas},{type:'content',canvas:{objects:[]}}]};
  assert.throws(()=>removeStudioPage(work,0),/защищены/);assert.ok(pageHasContent(work.bookPages[2]));assert.equal(pageHasContent(work.bookPages[3]),false);
  assert.equal(removeStudioPage(work,2),2);assert.equal(work.bookPages.length,3);
  assert.throws(()=>removeStudioPage({documentPages:[{}]},0),/хотя бы один/);
});
