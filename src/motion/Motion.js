export const reducedMotion=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false;
// A short, inert visual snapshot lets old messages fade out while the stable
// message pane accepts the next conversation. Never used for polling updates.
export function fadePreviousMessages(stream){
  return fadePreviousContent(stream,'chat-message-ghost');
}
export function fadePreviousContent(stream,className){
  if(reducedMotion()||!stream.firstElementChild)return;
  stream.parentElement.querySelector(`:scope > .${className}`)?.remove();
  const ghost=stream.cloneNode(true);ghost.classList.add(className);ghost.inert=true;ghost.setAttribute('aria-hidden','true');
  for(const node of [ghost,...ghost.querySelectorAll('*')])for(const attribute of [...node.attributes])if(attribute.name.startsWith('data-')||attribute.name==='id'||attribute.name==='tabindex')node.removeAttribute(attribute.name);
  stream.parentElement.append(ghost);void animateLocal(ghost,{exit:true}).then(()=>ghost.remove());
}
export function animateLocal(element,{exit=false,panel=false}={}){
  if(!element||reducedMotion()||!element.animate)return Promise.resolve();
  const styles=getComputedStyle(element);
  const duration=parseFloat(styles.getPropertyValue(panel?'--motion-panel':'--motion-normal'))||(panel?260:200);
  const frames=exit?[{opacity:1,transform:'none'},{opacity:0,transform:'translateY(6px) scale(.985)'}]:[{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'none'}];
  const animation=element.animate(frames,{duration,easing:styles.getPropertyValue(exit?'--ease-exit':'--ease-standard').trim()||'ease',fill:'none'});
  return animation.finished.catch(()=>{});
}
