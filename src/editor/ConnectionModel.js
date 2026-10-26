export const CONNECTION_TYPES=Object.freeze({cause:'Причина → следствие',relation:'Связь',dependency:'Зависимость',hypothesis:'Предположение'});

export function normalizeConnections(connections=[],objects=[]){
  const ids=new Set(objects.map(object=>object.id)),seen=new Set(),usedIds=new Set();
  return (Array.isArray(connections)?connections:[]).flatMap((input,index)=>{
    if(!input||!ids.has(input.fromObjectId)||!ids.has(input.toObjectId)||input.fromObjectId===input.toObjectId)return [];
    const type=Object.hasOwn(CONNECTION_TYPES,input.type)?input.type:'cause';
    const key=JSON.stringify([input.fromObjectId,input.toObjectId,type]);
    if(seen.has(key))return [];seen.add(key);
    let id=String(input.id||`connection-${index}`);while(usedIds.has(id))id+='-copy';usedIds.add(id);
    return [{id,fromObjectId:input.fromObjectId,toObjectId:input.toObjectId,type,label:String(input.label||'').slice(0,160),style:{width:Math.max(1,Math.min(6,Number(input.style?.width)||2)),dash:type==='dependency'||type==='hypothesis'}}];
  });
}
export function createConnection(canvas,fromObjectId,toObjectId,type='cause'){
  if(!Object.hasOwn(CONNECTION_TYPES,type))throw new Error('Неизвестный тип связи');
  if(fromObjectId===toObjectId)throw new Error('Выберите другой объект');
  if(![fromObjectId,toObjectId].every(id=>canvas.objects.some(object=>object.id===id)))throw new Error('Объект больше не находится на странице');
  canvas.connections=normalizeConnections(canvas.connections,canvas.objects);
  if(canvas.connections.some(item=>item.fromObjectId===fromObjectId&&item.toObjectId===toObjectId&&item.type===type))throw new Error('Такая связь уже существует');
  const connection={id:`connection-${crypto.randomUUID()}`,fromObjectId,toObjectId,type,label:'',style:{width:2,dash:type==='dependency'||type==='hypothesis'}};
  canvas.connections.push(connection);return connection;
}
export function removeConnection(canvas,id){canvas.connections=(canvas.connections||[]).filter(item=>item.id!==id);}
export function reverseConnection(canvas,id){
  const connection=canvas.connections?.find(item=>item.id===id);if(!connection)throw new Error('Связь больше не существует');
  if(canvas.connections.some(item=>item.id!==id&&item.fromObjectId===connection.toObjectId&&item.toObjectId===connection.fromObjectId&&item.type===connection.type))throw new Error('Обратная связь этого типа уже существует');
  [connection.fromObjectId,connection.toObjectId]=[connection.toObjectId,connection.fromObjectId];
}
export function removeDanglingConnections(canvas){canvas.connections=normalizeConnections(canvas.connections,canvas.objects);}

function rectangle(object){
  const width=Math.max(1,Number(object.w??object.width)||1),height=Math.max(1,Number(object.h??object.height)||1);
  return {x:(Number(object.x)||0)+width/2,y:(Number(object.y)||0)+height/2,width,height,angle:(Number(object.rotation)||0)*Math.PI/180};
}
function edge(box,towards){
  const dx=towards.x-box.x,dy=towards.y-box.y,c=Math.cos(box.angle),s=Math.sin(box.angle);
  const localX=dx*c+dy*s,localY=-dx*s+dy*c;
  if(Math.abs(localX)+Math.abs(localY)<.001)return {x:box.x+box.width/2,y:box.y};
  const scale=1/Math.max(Math.abs(localX)/(box.width/2),Math.abs(localY)/(box.height/2));
  return {x:box.x+dx*scale,y:box.y+dy*scale};
}
export function connectionEndpoints(from,to){
  const a=rectangle(from),b=rectangle(to);
  // A body text frame often surrounds a photo. Center rays would reverse the
  // endpoints and cross the photo; attach the nearest pair of nested edges.
  const nested=(inner,outer)=>{
    if(inner.angle||outer.angle||Math.abs(inner.x-outer.x)+inner.width/2>outer.width/2||Math.abs(inner.y-outer.y)+inner.height/2>outer.height/2)return null;
    const choices=[
      {distance:inner.x-inner.width/2-(outer.x-outer.width/2),from:{x:inner.x-inner.width/2,y:inner.y},to:{x:outer.x-outer.width/2,y:inner.y}},
      {distance:outer.x+outer.width/2-(inner.x+inner.width/2),from:{x:inner.x+inner.width/2,y:inner.y},to:{x:outer.x+outer.width/2,y:inner.y}},
      {distance:inner.y-inner.height/2-(outer.y-outer.height/2),from:{x:inner.x,y:inner.y-inner.height/2},to:{x:inner.x,y:outer.y-outer.height/2}},
      {distance:outer.y+outer.height/2-(inner.y+inner.height/2),from:{x:inner.x,y:inner.y+inner.height/2},to:{x:inner.x,y:outer.y+outer.height/2}}
    ].sort((x,y)=>x.distance-y.distance);
    return {from:choices[0].from,to:choices[0].to};
  };
  const inside=nested(a,b);if(inside)return inside;
  const contains=nested(b,a);if(contains)return {from:contains.to,to:contains.from};
  return {from:edge(a,b),to:edge(b,a)};
}
