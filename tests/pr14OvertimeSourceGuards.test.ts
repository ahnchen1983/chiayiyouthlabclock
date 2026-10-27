import {describe,expect,it} from 'vitest';
import {overtimePreview} from '../netlify/functions/utils/overtimePreview';
import {compNormalPayEvidence} from '../netlify/functions/utils/compWorkflow';
import {overtimeActualSource} from '../netlify/functions/utils/overtimeWorkflow';
import {evidenceHash} from '../netlify/functions/utils/attendanceCaseLifecycle';
import {normalDays} from './fixtures/normalPay';
import {card} from './fixtures/payrollV2';

// Synthetic sources only; no Firebase client or emulator connection.
const rules={schemaVersion:'overtime-rules-v1',weekStartDay:0,wageComponents:'single-contract-amount',monthlyHourlyDivisor:240};
const days=()=>normalDays('2026-08').map(d=>({...d,policy:{...d.policy,overtimeRules:rules} as any}));
const context=()=>[...normalDays('2026-07').slice(-6),...normalDays('2026-09').slice(0,6)].map(d=>({...d,covered:true,employmentState:'not-employed'}));
describe('cross-month employment authority',()=>{
 it.each(['missing','uncovered','unknown-state'])('%s adjacent-day authority cannot certify a complete week',mode=>{
  const ctx=context();
  if(mode==='missing')ctx.shift();
  else ctx[0]=mode==='uncovered'?{date:ctx[0].date,covered:false} as any:{...ctx[0],employmentState:'unknown'};
  const result=overtimePreview({empId:'SYNTH',month:'2026-08',days:days(),contextDays:ctx,intervals:[]});
  expect(result.monthExact).toBeNull();
  expect(result.blocking.join()).toContain('跨月任職來源未完整核定');
 });
 it('explicitly covered nonemployment keeps an empty boundary week valid',()=>{
  const result=overtimePreview({empId:'SYNTH',month:'2026-08',days:days(),contextDays:context(),intervals:[]});
  expect(result.blocking).toEqual([]);
  expect(result.monthExact).toEqual({numerator:'0',denominator:'1'});
 });
});

function store(){
 const data=new Map<string,any>();
 const snapshot=(key:string)=>({id:key.split('/')[1],exists:data.has(key),data:()=>structuredClone(data.get(key))});
 const collection=(name:string,filters:Array<[string,any]>=[],limit=Infinity):any=>({
  doc:(id:string)=>({get:async()=>snapshot(name+'/'+id)}),
  where:(field:string,_op:string,value:any)=>collection(name,[...filters,[field,value]],limit),
  limit:(n:number)=>collection(name,filters,n),
  get:async()=>{const docs=[...data.keys()].filter(k=>k.startsWith(name+'/')).map(snapshot).filter(s=>filters.every(([f,v])=>s.data()[f]===v)).slice(0,limit);return {docs,size:docs.length};}
 });
 return {data,db:{collection}};
}
async function creditedSource(){
 const s=store(),tx={get:(r:any)=>r.get()},c={...card('2026-08-03','15:00','17:00'),id:'C',empId:'SYNTH'};
 s.data.set('clockRecords/C',c);
 const startDate='2026-08-03T15:00:00+08:00',endDate='2026-08-03T17:00:00+08:00',start=Date.parse(startDate)/60000,end=Date.parse(endDate)/60000;
 const actual=await overtimeActualSource(s.db,tx,'SYNTH',{start,end});
 const ot={id:'OT',empId:'SYNTH',status:'approved',revision:1,startDate,endDate,approvedMinutes:120,approvedIntervals:[{start,end}],actualSource:actual,approvalSourceVersion:actual.version};
 const basis={status:'confirmed',originalDate:'2026-08-03',rate:200,tiers:[{start,end,hourlyBasis:{numerator:'200',denominator:'1'},multiplier:{numerator:'4',denominator:'3'}}],version:'basis-v1',reviewedBy:'MANAGER',reviewedAt:'2026-08-04T00:00:00Z'};
 const eligibility={id:'OT',empId:'SYNTH',status:'approved',version:'review-v1',approvedBy:'MANAGER',approvedAt:'2026-08-04T00:00:00Z',overtimeVersion:evidenceHash(ot),dayType:'normal',eligibleMinutes:120,originalWageBasis:basis};
 s.data.set('overtimeRequests/OT',ot);s.data.set('compSourceReviews/OT',eligibility);
 s.data.set('compLedger/ENTRY',{id:'ENTRY',empId:'SYNTH',sequence:1,type:'credit',requestId:'CR',actor:'MANAGER',at:'2026-08-04T00:00:00Z',reason:'synthetic approval',allocations:[{lotId:'LOT',minutes:120}],lot:{start,end,startDate,endDate,workStart:start,sourceRoot:'OT',overtimeId:'OT',overtimeVersion:evidenceHash(ot),actualVersion:actual.version,eligibilityVersion:evidenceHash(eligibility),employeeChoice:true,employerConsent:{actor:'MANAGER'},policyVersion:'P',dayType:'normal',deadline:'2026-12-31',originalWageBasis:basis}});
 return s;
}
describe('outstanding comp settlement source binding without monthly uses',()=>{
 it('unchanged reviewed source stays readable even when its original month is locked',async()=>{
  const {db,data}=await creditedSource();data.set('monthLocks/2026-08',{locked:true});
  const result=await compNormalPayEvidence(db,null,'SYNTH','2026-12');
  expect(result.issues).toEqual([]);expect(result.outstanding).toHaveLength(1);
 });
 it.each(['card','eligibility','overtime'])('changed %s source blocks the expiry projection and preserves ledger',async kind=>{
  const {db,data}=await creditedSource();
  if(kind==='card')data.get('clockRecords/C').clockOutTime='18:00';
  else if(kind==='eligibility')data.get('compSourceReviews/OT').version='changed';
  else data.get('overtimeRequests/OT').revision=2;
  const before=JSON.stringify([...data]);
  const result=await compNormalPayEvidence(db,null,'SYNTH','2026-12');
  expect(result.issues.join()).toContain('補休未休批次原來源待覆核');
  expect(result.outstanding).toHaveLength(0);
  expect(JSON.stringify([...data])).toBe(before);
 });
});
