import {CONNECTION_TYPES,createConnection,removeConnection,reverseConnection} from './ConnectionModel.js';
import {renderConnections,renderConnectionInspector} from './ConnectionRenderer.js';

export function createConnectionController({context,sync,history,changed,feedback,selectObject}){
  let pageId=null,sourceId=null,selectedId=null,canvasElement=null;
  const current=()=>context()?.canvas;
  const refreshGeometry=()=>{
    const canvas=current();if(!canvasElement?.isConnected||!canvas)return;
    // During gestures DOM geometry is ahead of the committed history snapshot.
    const geometry=new Map([...canvasElement.querySelectorAll(':scope > .canvas-object')].map(element=>[element.dataset.objectId,{x:Number(element.dataset.x),y:Number(element.dataset.y),w:Number(element.dataset.w),h:Number(element.dataset.h),rotation:Number(element.dataset.rotation)}]));
    const view={...canvas,objects:canvas.objects.map(object=>({...object,...geometry.get(object.id)}))};
    canvasElement.querySelector(':scope > .canvas-connections')?.remove();
    canvasElement.insertAdjacentHTML('afterbegin',renderConnections(view,{editable:true,selectedId,markerId:'editor-connection-arrow'}));
    canvasElement.querySelectorAll(':scope > .canvas-object').forEach(element=>element.classList.toggle('connection-source',element.dataset.objectId===sourceId));
  };
  const refresh=()=>{
    refreshGeometry();
    const box=document.querySelector('#pageConnections');if(box&&current())box.innerHTML=renderConnectionInspector(current(),selectedId);
    const status=document.querySelector('#connectionModeStatus');if(status)status.textContent=sourceId?'Выберите второй объект. Escape — отмена.':'';
    const cancelButton=document.querySelector('[data-action="connection-cancel"]');if(cancelButton)cancelButton.disabled=!sourceId;
    canvasElement?.classList.toggle('is-connecting',!!sourceId);
  };
  const cancel=()=>{if(!sourceId)return;sourceId=null;refresh();feedback('Связь отменена');};
  const mutate=(label,operation)=>{
    sync();history.begin(label);
    try{operation(current());history.commit();changed();refresh();}
    catch(error){history.history.cancel();throw error;}
  };
  const handleAction=(action,element)=>{
    if(action==='connection-start'){
      const id=document.querySelector('#freePageCanvas > .is-selected')?.dataset.objectId;
      if(!id)throw new Error('Сначала выберите объект');
      sourceId=id;selectedId=null;refresh();feedback('Выберите второй объект');return;
    }
    if(action==='connection-cancel'){cancel();return;}
    const id=element.dataset.id;
    if(action==='connection-select'){
      sourceId=null;selectObject(null);selectedId=id;refresh();
      document.querySelector('#pageConnections')?.scrollIntoView({block:'nearest'});return;
    }
    if(action==='connection-delete'){mutate('delete connection',canvas=>removeConnection(canvas,id));selectedId=null;refresh();return;}
    if(action==='connection-reverse')mutate('reverse connection',canvas=>reverseConnection(canvas,id));
  };
  const objectSelected=()=>{selectedId=null;refresh();};
  const attach=()=>{
    canvasElement=document.querySelector('#freePageCanvas');
    const next=context()?.page.id||null;if(next!==pageId){sourceId=null;selectedId=null;pageId=next;}
    if(!canvasElement)return;
    canvasElement.addEventListener('pointerdown',event=>{
      if(!sourceId){
        // Transparent body text blocks cover much of the page. Hit-test paths
        // behind them without raising photos or changing object layer order.
        const object=event.target.closest('.canvas-object');
        if(!object||object.dataset.objectType!=='text'||!['','transparent'].includes(object.dataset.bg||'')||event.target.closest('.canvas-object-chrome'))return;
        const hit=[...canvasElement.querySelectorAll('.connection-hit')].find(path=>{
          const matrix=path.getScreenCTM();if(!matrix)return false;
          return path.isPointInStroke(new globalThis.DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse()));
        });
        if(hit){event.preventDefault();event.stopImmediatePropagation();handleAction('connection-select',{dataset:{id:hit.closest('[data-connection-id]').dataset.connectionId}});}
        return;
      }
      const object=event.target.closest('.canvas-object');
      event.preventDefault();event.stopImmediatePropagation();
      if(!object){cancel();return;}
      const type=document.querySelector('#newConnectionType')?.value||'cause';
      try{mutate('create connection',canvas=>createConnection(canvas,sourceId,object.dataset.objectId,type));sourceId=null;refresh();feedback('Связь создана');}
      catch(error){feedback(error.message,{kind:'error'});}
    },true);
    const box=document.querySelector('#pageConnections');
    box?.addEventListener('change',event=>{
      if(!['connectionLabel','connectionType'].includes(event.target.id))return;
      try{mutate('edit connection',canvas=>{
        const item=canvas.connections.find(connection=>connection.id===selectedId);if(!item)throw new Error('Выберите связь');
        if(event.target.id==='connectionLabel')item.label=event.target.value.slice(0,160);
        else{
          const type=event.target.value;if(!Object.hasOwn(CONNECTION_TYPES,type))throw new Error('Неизвестный тип связи');
          if(canvas.connections.some(other=>other.id!==item.id&&other.fromObjectId===item.fromObjectId&&other.toObjectId===item.toObjectId&&other.type===type))throw new Error('Такая связь уже существует');
          item.type=type;item.style.dash=type==='dependency'||type==='hypothesis';
        }
      });}catch(error){feedback(error.message,{kind:'error'});refresh();}
    });
    canvasElement.addEventListener('keydown',event=>{const line=event.target.closest('[data-action="connection-select"]');if(line&&['Enter',' '].includes(event.key)){event.preventDefault();handleAction('connection-select',line);}});
    refresh();
  };
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&sourceId){event.preventDefault();event.stopImmediatePropagation();cancel();return;}
    if(selectedId&&canvasElement?.isConnected&&['Delete','Backspace'].includes(event.key)&&!event.target.closest('input,textarea,select,[contenteditable="true"]')){event.preventDefault();handleAction('connection-delete',{dataset:{id:selectedId}});}
  });
  return {attach,handleAction,refreshGeometry,objectSelected};
}
