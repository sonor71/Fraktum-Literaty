// Binary media from old snapshots stays in memory while the original snapshot
// remains untouched. No new JSON/localStorage write may discard that source.
const sources=new Map();

export function preserveLegacyImage(source){
  const value=String(source||'');
  if(!/^(?:data:|blob:)/i.test(value))return null;
  let hash=2166136261;
  for(let index=0;index<value.length;index++)hash=Math.imul(hash^value.charCodeAt(index),16777619);
  const key=`legacy-${value.length}-${hash>>>0}`;sources.set(key,value);return key;
}

export function hasLegacyRecovery(value){
  if(!value||typeof value!=='object')return false;
  if(value.legacyMediaKey||value.backgroundRecoveryKey||value.coverRecoveryKey)return true;
  return Object.values(value).some(child=>Array.isArray(child)?child.some(hasLegacyRecovery):hasLegacyRecovery(child));
}

export async function legacyImageFile(key){
  const source=sources.get(key);
  if(!source)throw new Error('Исходник старого изображения недоступен. Откройте исходное устройство или загрузите файл повторно.');
  if(source.startsWith('blob:')){
    const response=await fetch(source);
    if(!response.ok)throw new Error('Временное изображение больше недоступно. Загрузите исходный файл повторно.');
    const blob=await response.blob();return new File([blob],'restored-image.png',{type:blob.type||'image/png'});
  }
  const match=/^data:([^;,]+)(;base64)?,(.*)$/s.exec(source);
  if(!match)throw new Error('Некорректное старое изображение');
  const bytes=match[2]?Uint8Array.from(globalThis.atob(match[3]),char=>char.charCodeAt(0)):new globalThis.TextEncoder().encode(decodeURIComponent(match[3]));
  return new File([bytes],`restored-image.${match[1].split('/')[1]||'png'}`,{type:match[1]});
}

export function replaceLegacyReferences(value,key,asset){
  if(!value||typeof value!=='object')return;
  if(value.legacyMediaKey===key){delete value.legacyMediaKey;Object.assign(value,{assetId:asset.assetId,assetPath:asset.storagePath,storagePath:asset.storagePath,url:asset.url,src:asset.url});}
  if(value.backgroundRecoveryKey===key){delete value.backgroundRecoveryKey;Object.assign(value,{image:asset.url,assetPath:asset.storagePath,assetId:asset.assetId});}
  if(value.coverRecoveryKey===key){delete value.coverRecoveryKey;value.cover=asset.url;}
  for(const child of Object.values(value))if(Array.isArray(child))child.forEach(item=>replaceLegacyReferences(item,key,asset));else replaceLegacyReferences(child,key,asset);
}

export function legacyRecoveryKeys(value){
  const keys=new Set();
  const visit=item=>{if(!item||typeof item!=='object')return;for(const [name,child] of Object.entries(item)){if(['legacyMediaKey','backgroundRecoveryKey','coverRecoveryKey'].includes(name)&&child)keys.add(child);else if(Array.isArray(child))child.forEach(visit);else visit(child);}};
  visit(value);return [...keys];
}
