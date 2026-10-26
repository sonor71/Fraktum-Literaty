export function scrollSelectedPage(list){
  const selected=list?.querySelector('.page-list-item.active');if(!selected)return;
  // Equivalent to block:'nearest', scoped to this scroll box. scrollIntoView's
  // ancestor scrolling in older browsers would also move the whole document.
  const box=list.getBoundingClientRect(),item=selected.getBoundingClientRect();
  if(item.top<box.top)list.scrollTop-=box.top-item.top;
  else if(item.bottom>box.bottom)list.scrollTop+=item.bottom-box.bottom;
}
export function pageHasContent(page){
  return !!(page.canvas?.connections?.length||page.canvas?.background?.image||page.canvas?.objects?.some(object=>object.type==='image'||String(object.html||'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,'').trim()));
}
export function removeStudioPage(work,index){
  const key=work.editorMode==='book'?'bookPages':'documentPages',pages=work[key];
  if(!Number.isInteger(index)||!pages?.[index])throw new Error('Страница не найдена');
  if(pages.length<=1)throw new Error('В проекте должен остаться хотя бы один лист');
  if(['cover','title'].includes(pages[index].type))throw new Error('Обложка и титульный лист защищены от удаления');
  pages.splice(index,1);return Math.max(0,Math.min(index,pages.length-1));
}
