import {describe,it,expect,beforeEach} from 'vitest';
import {UserRole} from '../types';
import {handleOvertimeCompPolicyAction} from '../netlify/functions/utils/overtimeCompPolicy';
import {deriveCompEligibility} from '../netlify/functions/utils/compEligibility';
import {normalPolicy} from './fixtures/normalPay';
import {card} from './fixtures/payrollV2';
// Synthetic only: accounts, rates and dates are not company records.
const data=new Map<string,any>();
const clone=(x:any)=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const doc=(path:string):any=>({path,id:path.split('/').pop(),async get(){return {id:path.split('/').pop(),exists:data.has(path),data:()=>clone(data.get(path))};}});
const collection=(path:string,filters:any[]=[],limit=Infinity):any=>({doc:(id:string)=>doc(path+'/'+id),where:(f:string,_:string,v:any)=>collection(path,[...filters,[f,v]],limit),limit:(n:number)=>collection(path,filters,n),
 async get(){const docs=[...data.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===2).map(k=>({id:k.split('/')[1],data:()=>clone(data.get(k))})).filter(d=>filters.every(([f,v])=>d.data()[f]===v)).slice(0,limit);return {docs,size:docs.length};}});
const db:any={collection,async runTransaction(fn:any){const writes:any[]=[];let wrote=false;const tx:any={get:async(r:any)=>{if(wrote)throw Error('read after write');return r.get();}};for(const m of ['set','create'])tx[m]=(r:any,v:any)=>{wrote=true;writes.push([m,r,v]);};const result=await fn(tx);for(const [m,r,v] of writes){if(m==='create'&&data.has(r.path))throw Error('exists');data.set(r.path,clone(v));}return result;}};
let n=0;const op=()=>'op-'+(++n);
const act=(uid:string,action:string,body:any={})=>handleOvertimeCompPolicyAction(db,uid,action,{empId:'EMP',...body});
const code=async(p:Promise<any>)=>{try{await p;return 0;}catch(e:any){return e.statusCode;}};
const propose=(uid='A1',extra:any={})=>act(uid,'propose-overtime-comp-policy',{operationId:op(),expectedRevision:0,reviewerIds:['A2'],effectiveFrom:'2026-08-01',effectiveTo:'2027-07-31',reason:'設定加班補休安排',...extra});
beforeEach(()=>{data.clear();data.set('employees/EMP',{id:'EMP',role:UserRole.Employee});data.set('employees/A1',{id:'A1',role:UserRole.Admin});data.set('employees/A2',{id:'A2',role:UserRole.SuperAdmin});});
describe('two-person policy with the employee agreement in between',()=>{
 it('admin proposes, employee agrees, a different admin approves → both current policies written',async()=>{
  expect((await propose()).status).toBe('awaiting-employee');
  expect(await code(act('A2','review-overtime-comp-policy',{operationId:op(),expectedRevision:1,mode:'approve',reason:'核定政策內容'}))).toBe(409);
  expect((await act('EMP','agree-overtime-comp-policy',{operationId:op(),expectedRevision:1})).status).toBe('awaiting-approval');
  const r=await act('A2','review-overtime-comp-policy',{operationId:op(),expectedRevision:2,mode:'approve',reason:'核定政策內容'});expect(r.status).toBe('approved');
  expect(data.get('compPolicies/EMP')).toMatchObject({status:'approved',approvedBy:'A2',employeeAgreedBy:'EMP',reviewerIds:['A2'],deadlineRule:'annual-leave-year-end',conversion:'one-to-one'});
  expect(data.get('overtimeWorkflowPolicies/EMP')).toMatchObject({status:'approved',reviewerIds:['A2'],effectiveFrom:'2026-08-01'});expect(data.has('overtimeCompPolicyVersions/'+r.version)).toBe(true);
 });
 it('the proposer cannot approve; employees cannot propose or agree for others',async()=>{await propose();await act('EMP','agree-overtime-comp-policy',{operationId:op(),expectedRevision:1});expect(await code(act('A1','review-overtime-comp-policy',{operationId:op(),expectedRevision:2,mode:'approve',reason:'自己核定測試'}))).toBe(403);
  data.set('employees/E2',{id:'E2',role:UserRole.Employee});expect(await code(act('E2','agree-overtime-comp-policy',{operationId:op(),expectedRevision:2}))).toBe(403);expect(await code(handleOvertimeCompPolicyAction(db,'EMP','propose-overtime-comp-policy',{empId:'EMP',operationId:op(),expectedRevision:2,reviewerIds:['A2'],effectiveFrom:'2026-08-01',effectiveTo:'2026-12-31',reason:'自己提案測試'}))).toBe(403);});
 it('reviewers must be admins and never the employee',async()=>{expect(await code(propose('A1',{reviewerIds:['EMP']}))).toBe(400);data.set('employees/E2',{id:'E2',role:UserRole.Employee});expect(await code(propose('A1',{reviewerIds:['E2']}))).toBe(400);});
 it('stale revisions and replays with different content fail closed',async()=>{await propose();expect(await code(propose())).toBe(409);const id='same';await act('EMP','agree-overtime-comp-policy',{operationId:id,expectedRevision:1});expect((await act('EMP','agree-overtime-comp-policy',{operationId:id,expectedRevision:1})).revision).toBe(2);expect(await code(act('EMP','agree-overtime-comp-policy',{operationId:id,expectedRevision:9}))).toBe(409);});
});
describe('comp eligibility derived from payroll sources',()=>{
 const seed=(dayType='normal')=>{const at='2026-07-01T00:00:00Z';data.set('payrollMasterHeads/EMP',{currentVersionId:'V',revision:1});data.set('payrollMasterVersions/V',{empId:'EMP',status:'approved',approvedBy:'A2',approvedAt:at,timeline:{accountKind:'employee',from:'2026-08-01',to:'2026-08-31',periods:[{from:'2026-08-01',to:'2026-08-31',employmentState:'active',employmentType:'part-time',payBasis:'hourly',amount:200,policyVersionId:'P',dayTypeCalendarId:'D'}]}});
  data.set('payrollPolicyVersions/P',{status:'approved',version:'pv',approvedBy:'A2',approvedAt:at,employeeIds:['EMP'],from:'2026-08-01',to:'2026-08-31',normalPay:normalPolicy()});
  data.set('dayTypeCalendars/D',{status:'approved',version:'d1',approvedBy:'A2',approvedAt:at,employeeIds:['EMP'],days:Object.fromEntries(Array.from({length:31},(_,i)=>['2026-08-'+String(i+1).padStart(2,'0'),dayType]))});};
 const at=(t:string)=>Date.parse(t+'+08:00')/60000,tx={get:(r:any)=>r.get()};
 it('weekday: only minutes beyond 8h are eligible, with the 4/3 basis kept',async()=>{seed();data.set('clockRecords/C',{...card('2026-08-03','08:00','17:00'),id:'C',empId:'EMP'});
  const e=await deriveCompEligibility(db,tx,'EMP',{approvedIntervals:[{start:at('2026-08-03T15:00'),end:at('2026-08-03T17:00')}]},'v');
  expect(e!.eligibleMinutes).toBe(60);const b=e!.dayEvidence['2026-08-03'].originalWageBasis;expect(b.status).toBe('confirmed');expect(b.rate).toBe(200);expect(b.tiers[0]).toMatchObject({minutes:60,multiplier:{numerator:'4',denominator:'3'}});});
 it('rest day: all worked minutes are eligible at the rest-day tiers',async()=>{seed('rest');data.set('clockRecords/C',{...card('2026-08-03','09:00','12:00'),id:'C',empId:'EMP'});const e=await deriveCompEligibility(db,tx,'EMP',{approvedIntervals:[{start:at('2026-08-03T09:00'),end:at('2026-08-03T12:00')}]},'v');expect(e!.eligibleMinutes).toBe(180);expect(e!.dayEvidence['2026-08-03'].originalWageBasis.tiers.map((t:any)=>t.multiplier.numerator)).toEqual(['4','5']);});
 it('national holiday work is never eligible (Art.32-1)',async()=>{seed('national-holiday');data.set('clockRecords/C',{...card('2026-08-03','09:00','12:00'),id:'C',empId:'EMP'});const e=await deriveCompEligibility(db,tx,'EMP',{approvedIntervals:[{start:at('2026-08-03T09:00'),end:at('2026-08-03T12:00')}]},'v');expect(e!.eligibleMinutes).toBe(0);});
 it('without an effective master it defers to an explicit source review',async()=>{expect(await deriveCompEligibility(db,tx,'EMP',{approvedIntervals:[{start:1,end:2}]},'v')).toBeNull();});
});
