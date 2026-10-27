/** Minutes only. Append-only journal; no payroll valuation or current-rate substitution. */
export type CompEntryType='credit'|'reserve'|'debit'|'release'|'adjustment';
export interface CompAllocation {lotId:string;minutes:number}
export interface CompEntry {id:string;empId:string;sequence:number;type:CompEntryType;requestId:string;actor:string;at:string;reason:string;allocations:CompAllocation[];lot?:any;approval?:any}
const invalid=(message:string):never=>{throw Object.assign(new Error(message),{statusCode:409});};
export function foldCompLedger(entries:CompEntry[]){
 const lots=new Map<string,any>(),reservations=new Map<string,CompAllocation[]>(),ids=new Set<string>(),sources=new Set<string>();let sequence=0;
 for(const e of [...entries].sort((a,b)=>a.sequence-b.sequence)){
  if(ids.has(e.id)||e.sequence!==++sequence||!e.actor||!e.reason||!Number.isFinite(Date.parse(e.at))||!Array.isArray(e.allocations)||!e.allocations.length)invalid('補休帳本順序／證據不一致');ids.add(e.id);
  const allocationIds=new Set<string>();for(const a of e.allocations)if(!a.lotId||allocationIds.has(a.lotId)||!Number.isSafeInteger(a.minutes)||a.minutes<=0)invalid('補休帳本分鐘／來源重複');else allocationIds.add(a.lotId);
  if(e.type==='credit'){
   const a=e.allocations[0],lot=e.lot;if(e.allocations.length!==1||lots.has(a.lotId)||!lot?.sourceRoot||sources.has(lot.sourceClaimId||lot.sourceRoot)||!lot.employeeChoice||!lot.employerConsent||!lot.policyVersion||!['normal','rest'].includes(lot.dayType))invalid('補休取得缺來源／雙方同意或重複');
   sources.add(lot.sourceClaimId||lot.sourceRoot);lots.set(a.lotId,{...lot,id:a.lotId,credited:a.minutes,reserved:0,used:0,adjusted:0,available:a.minutes});continue;
  }
  if(e.type==='reserve'){
   if(reservations.has(e.requestId))invalid('補休重複預占');reservations.set(e.requestId,e.allocations);
  }else if(e.type==='release'||e.type==='debit'){
   if(JSON.stringify(reservations.get(e.requestId))!==JSON.stringify(e.allocations))invalid('補休使用／釋放與原預占不一致');reservations.delete(e.requestId);
  }else if(e.type==='adjustment'){
   if(!e.approval?.proposedBy||e.approval.proposedBy===e.actor||!e.approval.sourceVersion)invalid('補休更正缺獨立覆核');
  }else invalid('補休帳本未知事件');
  for(const a of e.allocations){const l=lots.get(a.lotId);if(!l)invalid('補休來源批次不存在');
   if(e.type==='reserve'){l.available-=a.minutes;l.reserved+=a.minutes;}
   if(e.type==='release'){l.available+=a.minutes;l.reserved-=a.minutes;}
   if(e.type==='debit'){l.reserved-=a.minutes;l.used+=a.minutes;}
   if(e.type==='adjustment'){l.available-=a.minutes;l.adjusted+=a.minutes;}
   if(l.available<0||l.reserved<0||l.used<0||l.credited!==l.available+l.reserved+l.used+l.adjusted)invalid('補休帳本負餘額或不平');
  }
 }
 return {lots:[...lots.values()],reservations,sequence,available:[...lots.values()].reduce((n,l)=>n+l.available,0),reserved:[...lots.values()].reduce((n,l)=>n+l.reserved,0),used:[...lots.values()].reduce((n,l)=>n+l.used,0)};
}
export function fifoComp(lots:any[],minutes:number){
 if(!Number.isSafeInteger(minutes)||minutes<=0)invalid('補休分鐘無效');let remaining=minutes;const allocations:CompAllocation[]=[];
 for(const l of [...lots].sort((a,b)=>a.workStart-b.workStart||a.id.localeCompare(b.id))){const take=Math.min(remaining,l.available);if(take>0)allocations.push({lotId:l.id,minutes:take});remaining-=take;if(!remaining)break;}
 if(remaining)invalid('已確認可用補休不足；不可使用待政策時數');return allocations;
}
