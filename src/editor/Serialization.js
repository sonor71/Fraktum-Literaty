const DATA_URL=/^(?:data:|blob:)|\bsrc\s*=\s*["']\s*(?:data:|blob:)/i;

export function assertPersistableDocument(value){
  const visit=(item,path='document')=>{
    if(typeof item==='string'&&DATA_URL.test(item))throw new TypeError(`${path} contains embedded binary data`);
    if(Array.isArray(item))item.forEach((child,index)=>visit(child,`${path}[${index}]`));
    else if(item&&typeof item==='object')Object.entries(item).forEach(([key,child])=>visit(child,`${path}.${key}`));
  };
  visit(value);return value;
}

export function cloneSnapshot(value){return structuredClone(assertPersistableDocument(value));}
