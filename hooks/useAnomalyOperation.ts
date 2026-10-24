import {useEffect,useState} from 'react';
import {useAuth} from '../contexts/AuthContext';
import {APIError,apiAnomalyMutation,type AnomalyMutationAction} from '../services/googleAppsScriptAPI';
export interface AnomalyIntent {action:AnomalyMutationAction;command:Record<string,any> & {operationId:string;caseId:string}}
const event='anomaly-workflow-pending',key=(uid:string)=>'anomaly-workflow-pending-v1:'+uid;
let inFlight=false;
const read=(uid:string):AnomalyIntent|null=>{const raw=sessionStorage.getItem(key(uid));if(!raw)return null;const p=JSON.parse(raw);if(!['submit-overtime-request','act-overtime-request','act-leave-version','submit-anomaly-explanation','act-anomaly-explanation','submit-case-leave','link-case-leave','review-case-leave'].includes(p?.action)||typeof p.command?.operationId!=='string'||typeof p.command?.caseId!=='string')throw Error('invalid pending workflow');return p;};
// Same confirmed-outcome discipline as B4a: GET does not clear an uncertain write.
export function useAnomalyOperation(){
 const {user}=useAuth(),uid=user!.id;const [pending,setPending]=useState<AnomalyIntent|null>(null),[blocked,setBlocked]=useState(false),[busy,setBusy]=useState(false);
 const refresh=()=>{try{setPending(read(uid));}catch{setBlocked(true);}};
 useEffect(()=>{refresh();window.addEventListener(event,refresh);return()=>window.removeEventListener(event,refresh);},[uid]);
 const attempt=async(proposed:AnomalyIntent)=>{
  if(inFlight||blocked)throw Error('仍有操作或暫存無法確認');inFlight=true;setBusy(true);let prior:AnomalyIntent|null=null;
  const signal=()=>window.dispatchEvent(new Event(event));
  try{prior=read(uid);if(prior&&JSON.stringify(prior)!==JSON.stringify(proposed))throw Error('請先核實原操作');sessionStorage.setItem(key(uid),JSON.stringify(proposed));signal();const result=await apiAnomalyMutation(proposed.action,proposed.command);sessionStorage.removeItem(key(uid));signal();return result;}
  catch(e){if(!prior&&e instanceof APIError&&[400,403,404,409,423].includes(e.status)){sessionStorage.removeItem(key(uid));signal();}throw e;}
  finally{inFlight=false;setBusy(false);refresh();}
 };
 return {pending,blocked,busy,attempt};
}
