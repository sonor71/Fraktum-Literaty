import {esc} from '../ui.js';
import {CONNECTION_TYPES,connectionEndpoints,normalizeConnections} from './ConnectionModel.js';

export function renderConnections(canvas,{editable=false,selectedId=null,markerId='connection-arrow'}={}){
  const objects=new Map(canvas.objects.map(object=>[object.id,object]));
  const lines=normalizeConnections(canvas.connections,canvas.objects).map(connection=>{
    const endpoints=connectionEndpoints(objects.get(connection.fromObjectId),objects.get(connection.toObjectId));
    const {from,to}=endpoints,label=connection.label,type=connection.type;
    const attributes=editable?`data-action="connection-select" data-id="${esc(connection.id)}" role="button" tabindex="0" aria-label="${esc(`${CONNECTION_TYPES[type]}${label?`: ${label}`:''}`)}"`:'';
    const path=`M ${from.x.toFixed(2)} ${from.y.toFixed(2)} L ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
    return `<g class="canvas-connection ${selectedId===connection.id?'is-selected':''} connection-${type}" data-connection-id="${esc(connection.id)}" ${attributes}><title>${esc(CONNECTION_TYPES[type])}${label?`: ${esc(label)}`:''}</title>${editable?`<path class="connection-hit" d="${path}"/>`:''}<path class="connection-line" d="${path}" stroke-width="${connection.style.width}" ${type==='cause'||type==='dependency'?`marker-end="url(#${esc(markerId)})"`:''} ${type==='dependency'?'stroke-dasharray="9 6"':type==='hypothesis'?'stroke-dasharray="2 6"':''}/>${label?`<text class="connection-label" x="${(from.x+to.x)/2}" y="${(from.y+to.y)/2-8}" text-anchor="middle">${esc(label)}</text>`:''}</g>`;
  }).join('');
  return `<svg class="canvas-connections ${editable?'editable':''}" viewBox="0 0 760 1080" aria-label="Связи страницы" ${editable?'':'aria-hidden="true"'}><defs><marker id="${esc(markerId)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>${lines}</svg>`;
}
const button=(action,id,label)=>`<button type="button" data-action="${action}" data-id="${esc(id)}" aria-label="${esc(label)}" title="${esc(label)}">${esc(label)}</button>`;
export function renderConnectionInspector(canvas,selectedId){
  const objects=new Map(canvas.objects.map(object=>[object.id,object]));
  const name=id=>{const object=objects.get(id);return String(object?.alt||object?.html?.replace(/<[^>]*>/g,' ').trim()||'Объект').slice(0,45);};
  const connections=normalizeConnections(canvas.connections,canvas.objects),selected=connections.find(item=>item.id===selectedId);
  return `<h4>Связи страницы</h4><div class="connection-list">${connections.map(item=>`<div class="connection-row ${item.id===selectedId?'active':''}"><span>${esc(name(item.fromObjectId))} → ${esc(name(item.toObjectId))}<small>${esc(CONNECTION_TYPES[item.type])}${item.label?` · ${esc(item.label)}`:''}</small></span><div>${button('connection-select',item.id,'Изменить связь')}${button('connection-reverse',item.id,'Развернуть связь')}${button('connection-delete',item.id,'Удалить связь')}</div></div>`).join('')||'<p class="muted">Выберите объект и нажмите «Связать».</p>'}</div>${selected?`<fieldset class="connection-editor"><legend>Выбранная связь</legend><label>Тип<select id="connectionType" aria-label="Тип связи" title="Тип связи">${Object.entries(CONNECTION_TYPES).map(([value,label])=>`<option value="${value}" ${selected.type===value?'selected':''}>${label}</option>`).join('')}</select></label><label>Подпись<input id="connectionLabel" aria-label="Подпись связи" title="Подпись связи" maxlength="160" value="${esc(selected.label)}"></label>${button('connection-reverse',selected.id,'Развернуть связь')}${button('connection-delete',selected.id,'Удалить связь')}</fieldset>`:''}`;
}
