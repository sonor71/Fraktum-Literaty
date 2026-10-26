export const NAVIGATION_PAGES=new Set(['home','evaluate','evaluation','read','work','reader','library','create','notes','communities','community','messages','profile','analytics','admin','feedback']);
export const POST_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function routeFromLocation(location){
  const post=String(location.pathname||'').match(/^\/post\/([^/]+)\/?$/);
  if(post)return {page:'post',postId:POST_UUID.test(post[1])?post[1]:null};
  const page=String(location.hash||'').replace(/^#\/?/,'');
  return {page:NAVIGATION_PAGES.has(page)?page:'home'};
}

export function routeUrl(route){
  if(route.page==='post'&&POST_UUID.test(route.postId||''))return `/post/${route.postId}`;
  return `/#/${NAVIGATION_PAGES.has(route.page)?route.page:'home'}`;
}

// Only the page participates. The persistent navigation and chat remain still.
export function transitionPage(update,{document:doc=globalThis.document,reducedMotion=false}={}){
  if(reducedMotion){update();return Promise.resolve();}
  if(typeof doc.startViewTransition==='function'){
    const transition=doc.startViewTransition(update);
    // A transition can be skipped by the browser; rendering errors still reach
    // the caller through updateCallbackDone.
    transition.ready?.catch(()=>{});
    transition.finished?.catch(()=>{});
    return transition.updateCallbackDone;
  }
  update();
  const page=doc.querySelector('.page');
  if(page){
    page.classList.add('navigation-enter');
    page.addEventListener('animationend',()=>page.classList.remove('navigation-enter'),{once:true});
  }
  return Promise.resolve();
}
