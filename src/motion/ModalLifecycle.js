import {animateLocal,reducedMotion} from './Motion.js';

export class ModalLifecycle {
  constructor({root,onClose=()=>{}}){Object.assign(this,{root,onClose});this.revision=0;}
  open(html){
    const revision=++this.revision;this.node?.remove();this.previousFocus=document.activeElement;
    const template=document.createElement('template');template.innerHTML=html;this.node=template.content.firstElementChild;
    this.root.append(this.node);this.node.dataset.phase='opening';
    const node=this.node;this.entering=Promise.all([this.fade(node,false),animateLocal(node.querySelector('.modal'),{panel:true})]).then(()=>{if(this.node===node&&this.revision===revision){node.dataset.phase='open';}});
    node.querySelector('input:not([type="hidden"]),textarea,button,[tabindex]')?.focus({preventScroll:true});
  }
  fade(node,exit){
    if(reducedMotion()||!node.animate)return Promise.resolve();
    const styles=getComputedStyle(node),duration=parseFloat(styles.getPropertyValue('--motion-panel'))||260;
    return node.animate([{opacity:exit?1:0},{opacity:exit?0:1}],{duration,easing:styles.getPropertyValue('--ease-standard').trim()||'ease',fill:'none'}).finished.catch(()=>{});
  }
  close(){
    if(!this.node)return Promise.resolve();if(this.closingNode===this.node)return this.closing;
    const node=this.node,revision=++this.revision;this.closingNode=node;node.dataset.phase='closing';node.inert=true;this.onClose();
    node.getAnimations({subtree:true}).forEach(animation=>animation.cancel());
    this.closing=Promise.all([this.fade(node,true),animateLocal(node.querySelector('.modal'),{exit:true,panel:true})]).then(()=>{
      node.remove();if(this.revision!==revision)return;this.node=null;this.closingNode=null;
      if(this.previousFocus?.isConnected)this.previousFocus.focus({preventScroll:true});
    });return this.closing;
  }
  discard(){++this.revision;this.node?.remove();this.node=null;this.closingNode=null;}
  // Global navigation must not re-create an unsaved dialog or its animation.
  restore(){if(this.node&&!this.node.isConnected)this.root.append(this.node);}
  trap(event){
    if(!this.node||this.closingNode===this.node)return;
    if(event.key==='Escape'){event.preventDefault();this.close();return true;}
    if(event.key!=='Tab')return;
    const controls=[...this.node.querySelectorAll('button:not(:disabled),input:not([type="hidden"]),textarea,select,a[href],[tabindex="0"]')].filter(node=>node.getClientRects().length);
    const first=controls[0],last=controls.at(-1);if(!first)return;
    if(event.shiftKey&&document.activeElement===first){last.focus();event.preventDefault();}else if(!event.shiftKey&&document.activeElement===last){first.focus();event.preventDefault();}
  }
}
