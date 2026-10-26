/** Serializes create/update requests so autosave cannot create duplicate drafts. */
export function createSaveQueue(){
  let previous=Promise.resolve();
  return operation=>{
    const next=previous.then(operation,operation);
    // A failed request rejects its caller; later edits may retry independently.
    previous=next.then(()=>undefined,()=>undefined);
    return next;
  };
}
