import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { APIError, apiActMakeupRequest, apiLinkCaseRequest, apiSubmitMakeupVersion } from '../services/googleAppsScriptAPI';
export type MakeupOperation=({contextCaseId?:string} & ({kind:'submit';command:Parameters<typeof apiSubmitMakeupVersion>[0]}|{kind:'act';command:Parameters<typeof apiActMakeupRequest>[0]}|{kind:'link';command:Parameters<typeof apiLinkCaseRequest>[0]}));
const event='makeup-pending-change',key=(uid:string)=>'makeup-pending-v1:'+uid;
let inFlight=false;
const read=(uid:string):MakeupOperation|null=>{const raw=sessionStorage.getItem(key(uid));if(!raw)return null;const p=JSON.parse(raw);if(!['submit','act','link'].includes(p?.kind)||typeof p.command?.operationId!=='string'||typeof p.command?.reason!=='string'||p.command.reason.length>2000)throw Error('invalid pending makeup');return p;};
// One unresolved mutation per principal/tab, shared by forms, rows and links.
// Every request remains server validated; stored payload is never automatically sent.
export function useMakeupOperation(){
 const {user}=useAuth();const uid=user!.id;const [pending,setPending]=useState<MakeupOperation|null>(null),[blocked,setBlocked]=useState(false),[busy,setBusy]=useState(false);
 const refresh=()=>{try{setPending(read(uid));}catch{setBlocked(true);}};
 useEffect(()=>{refresh();window.addEventListener(event,refresh);return()=>window.removeEventListener(event,refresh);},[uid]);
 const attempt=async(proposed:MakeupOperation)=>{
  if(inFlight||blocked)throw Error('尚有操作處理中或暫存不可用');
  inFlight=true;setBusy(true);let prior:MakeupOperation|null=null;
  const signal=()=>window.dispatchEvent(new Event(event));
  try{
   prior=read(uid);if(prior&&JSON.stringify(prior)!==JSON.stringify(proposed))throw Error('另一筆操作結果未確認，請返回原申請重試');
   try{sessionStorage.setItem(key(uid),JSON.stringify(proposed));}catch{setBlocked(true);throw Error('操作識別無法保存，本次未送出');}signal();
   let result;
   if(proposed.kind==='submit')result=await apiSubmitMakeupVersion(proposed.command);
   else if(proposed.kind==='act')result=await apiActMakeupRequest(proposed.command);
   else result=await apiLinkCaseRequest(proposed.command);
   sessionStorage.removeItem(key(uid));signal();return result;
  }catch(e){
   // A refusal on a retry is not proof the earlier attempt did not commit.
   if(!prior&&e instanceof APIError&&[400,403,404,409,423].includes(e.status)){sessionStorage.removeItem(key(uid));signal();}
   throw e;
  }finally{inFlight=false;setBusy(false);refresh();}
 };
 return {pending,blocked,busy,attempt};
}
