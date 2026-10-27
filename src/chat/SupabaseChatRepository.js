import {fetchMyConversations,fetchConversationMessages,sendCloudMessage,createCloudGroupConversation} from '../cloud.js';

export class SupabaseChatRepository {
  constructor({getUser,getPeople}){Object.assign(this,{getUser,getPeople});}
  fetchThreads(){return fetchMyConversations();}
  fetchMessages(id){return fetchConversationMessages(id);}
  async sendMessage(id,message){
    const rows=await sendCloudMessage(id,message.text,message.clientId),row=rows?.[0];
    if(!row?.id)throw new Error('Сервер не подтвердил сообщение');
    const user=this.getUser();
    return {id:row.id,fromId:row.sender_id,from:user.name||user.nickname,text:row.body,createdAt:row.created_at,time:new Date(row.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}),mine:true};
  }
  async createGroup({title,memberIds,clientId}){
    const id=await createCloudGroupConversation(title,memberIds,null,clientId);
    const members=this.getPeople().filter(person=>memberIds.includes(person.id));
    return {id,title,type:'group',cloud:true,callsEnabled:false,memberIds:members.map(person=>person.id),members,messages:[]};
  }
}
