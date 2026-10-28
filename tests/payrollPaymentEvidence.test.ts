import {beforeEach,describe,expect,it,vi} from 'vitest';
import {UserRole} from '../types';
const sourceState=vi.hoisted(()=>({hash:'a'.repeat(64),net:'30000'}));
vi.mock('../netlify/functions/utils/payrollSourceReader',()=>({loadPayrollMonthSource:vi.fn(async()=>({kind:'live',sourceHash:sourceState.hash,comparisons:{E1:{totals:{net:sourceState.net}}}}))}));
import {handlePayrollPaymentEvidenceAction as handle} from '../netlify/functions/utils/payrollPaymentEvidence';
const data=new Map<string,any>();
const clone=(x:any)=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const doc=(path:string):any=>({path,id:path.split('/').pop(),async get(){return {id:path.split('/').pop(),exists:data.has(path),data:()=>clone(data.get(path))};}});
const collection=(path:string,filters:any[]=[],limit=Infinity):any=>({doc:(id:string)=>doc(path+'/'+id),where:(f:string,_:string,v:any)=>collection(path,[...filters,[f,v]],limit),limit:(n:number)=>collection(path,filters,n),async get(){const docs=[...data.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===2).map(k=>({id:k.split('/')[1],data:()=>clone(data.get(k))})).filter(d=>filters.every(([f,v])=>d.data()[f]===v)).slice(0,limit);return {docs,size:docs.length};}});
let beforeTransaction:(()=>void)|null=null;
const db:any={collection,async runTransaction(fn:any){beforeTransaction?.();beforeTransaction=null;const writes:any[]=[];let wrote=false;const tx:any={get:async(r:any)=>{if(wrote)throw Error('read after write');return r.get();}};for(const m of ['set','create'])tx[m]=(r:any,v:any)=>{wrote=true;writes.push([m,r,v]);};const result=await fn(tx);for(const [m,r] of writes)if(m==='create'&&data.has(r.path))throw Error('exists');for(const [,r,v] of writes)data.set(r.path,clone(v));return result;}};

let seq=0;const inventory=()=>({empId:'E1',month:'2026-08',mode:'events',sourceRefs:['MONTH'],reason:'Synthetic complete payment evidence',events:[{id:'PAY-1',evidenceLocator:'ROW-1',paidOn:'2026-09-05',amount:'30000',sourceRefs:['STATEMENT'],reason:'Synthetic actual payment',incomeClassification:'salary-monthly',insuredCategory:'insured-here',exemption:null}]});
const propose=(uid='A1',expectedRevision=0,value=inventory(),operationId='op-'+(++seq))=>handle(db,uid,'propose-payroll-payment-evidence',{inventory:value,expectedRevision,operationId});
const review=(v:any,uid='A2',mode='approve')=>handle(db,uid,'review-payroll-payment-evidence',{empId:'E1',month:'2026-08',expectedRevision:v.revision,operationId:'op-'+(++seq),mode,reason:'Synthetic independent evidence review'});
const get=(uid='A1')=>handle(db,uid,'get-payroll-payment-evidence',{empId:'E1',month:'2026-08'});
beforeEach(()=>{data.clear();beforeTransaction=null;sourceState.hash='a'.repeat(64);sourceState.net='30000';for(const id of ['A1','A2','A3'])data.set('employees/'+id,{id,role:UserRole.SuperAdmin});data.set('employees/E1',{id:'E1',role:UserRole.Employee});});
describe('payment evidence immutable recording workflow',()=>{
 it('records and independently approves bound evidence without payment or deduction execution',async()=>{
  const p=await propose(),a=await review(p);expect(a).toMatchObject({status:'approved',sourceBinding:{sourceHash:sourceState.hash,net:'30000'},applicationStatus:'not-applied',paymentExecution:'none',legalValidation:'unresolved'});
  expect(data.get('payrollPaymentEvidenceVersions/'+p.id+'_1').status).toBe('proposed');expect((await get()).assessment.status).toBe('ready-evidence');
 });
 it('hides pending evidence from the subject and forbids self proposal/review',async()=>{
  const p=await propose();expect((await get('E1')).current).toBeNull();await expect(review(p,'A1')).rejects.toMatchObject({statusCode:403});await expect(propose('E1')).rejects.toMatchObject({statusCode:403});await review(p);expect((await get('E1')).current.status).toBe('approved');
 });
 it('excludes every historical proposer after replacement',async()=>{const a=await review(await propose());const p=await propose('A3',a.revision);await expect(review(p,'A1')).rejects.toMatchObject({statusCode:403});});
 it('rechecks source identity on approval and never approves stale monthly net',async()=>{const p=await propose();sourceState.hash='b'.repeat(64);await expect(review(p)).rejects.toMatchObject({statusCode:409});expect(data.get('payrollPaymentEvidence/'+p.id).status).toBe('proposed');});
 it('approves reviewed document facts while retaining mismatched reconciliation',async()=>{const v=inventory();v.events[0].amount='29999';const a=await review(await propose('A1',0,v));expect(a.status).toBe('approved');expect(a.assessment).toMatchObject({status:'needs-review',formalEligibility:'BLOCKED'});expect(a.assessment.issues).toContain('monthly-payable-reconciliation-mismatch');});
 it('records and independently reviews facts with unresolved canonical net without substituting zero',async()=>{sourceState.net=null as any;const p=await propose();expect(p.sourceBinding.net).toBeNull();expect(p.assessment.issues).toContain('monthly-payable-unresolved');const a=await review(p);expect(a).toMatchObject({status:'approved',sourceBinding:{net:null},assessment:{status:'needs-review',incomeTaxBase:null,pensionBasis:null}});const view=await get();expect(view).toMatchObject({sourceAvailable:true,reconciliationAvailable:false,stale:false});expect(view.assessment.status).toBe('needs-review');});
 it('requires fresh review when unresolved canonical net becomes known',async()=>{sourceState.net=null as any;const p=await propose();sourceState.net='30000';await expect(review(p)).rejects.toMatchObject({statusCode:409});});
 it('preserves confirmed zero rather than treating it as missing',async()=>{sourceState.net='0';const v=inventory();v.events[0].amount='0.00';const a=await review(await propose('A1',0,v));expect(a.inventory.events[0].amount).toBe('0');});
 it('rejects missing immutable proposals and head/history tampering',async()=>{const p=await propose();data.delete('payrollPaymentEvidenceVersions/'+p.id+'_1');await expect(review(p)).rejects.toMatchObject({statusCode:409});});
 it('replays only exact command payload after rereading actor role',async()=>{const v=inventory(),p=await propose('A1',0,v,'REPLAY');expect(await propose('A1',0,v,'REPLAY')).toEqual(p);v.reason='Different synthetic reason';await expect(propose('A1',0,v,'REPLAY')).rejects.toMatchObject({statusCode:409});data.set('employees/A1',{role:UserRole.Employee});await expect(propose('A1',0,inventory(),'REPLAY')).rejects.toMatchObject({statusCode:403});});
 it('blocks locked months before writes',async()=>{const p=await propose();data.set('monthLocks/2026-08',{yearMonth:'2026-08',lockedAt:'2026-09-01T00:00:00Z'});await expect(review(p)).rejects.toMatchObject({statusCode:423});});
 it('rereads authorization inside the mutation transaction',async()=>{beforeTransaction=()=>data.set('employees/A1',{role:UserRole.Employee});await expect(propose()).rejects.toMatchObject({statusCode:403});});
 it('rejects caller supplied authority fields',async()=>{await expect(handle(db,'A1','propose-payroll-payment-evidence',{inventory:inventory(),expectedRevision:0,operationId:'X',sourceBinding:{net:'30000'}})).rejects.toMatchObject({statusCode:400});});
});

describe('immutable explicit insurer query reply evidence',()=>{
 const queryInventory=(reply?:string):any=>{const v:any=inventory();v.events[0].insuredCategory='category-2-union';v.events[0].exemption={kind:'category-2-union',from:'2026-01-01',to:'2026-12-31',sourceRefs:['NHI-REPLY'],issuerRef:'NHI',proofKind:'insurer-query',providedAt:'2026-09-04T10:00:00+08:00',queriedAt:'2026-08-01T09:00:00+08:00',...(reply?{queryConfirmedOn:reply}:{})};return v;};
 it('persists reply date with source evidence through independent approval and historical read',async()=>{
  const p=await propose('A1',0,queryInventory('2026-08-05'));expect(p.inventory.events[0].exemption.queryConfirmedOn).toBe('2026-08-05');await expect(review(p,'A1')).rejects.toMatchObject({statusCode:403});
  const a=await review(p),view=await get();expect(a.assessment.status).toBe('ready-evidence');expect(view.current.inventory.events[0].exemption).toMatchObject({queryConfirmedOn:'2026-08-05',queriedAt:'2026-08-01T09:00:00+08:00',sourceRefs:['NHI-REPLY']});expect(view.versions.every((v:any)=>v.inventory.events[0].exemption.queryConfirmedOn==='2026-08-05')).toBe(true);
 });
 it('keeps legacy query records readable and unresolved without invented confirmation',async()=>{
  const a=await review(await propose('A1',0,queryInventory()));expect(a.assessment.issues).toContain('insurer-query-validity-unresolved:PAY-1');const view=await get();expect(view.current.inventory.events[0].exemption.queryConfirmedOn).toBeUndefined();expect(view.assessment.status).toBe('needs-review');
 });
 it('rejects changed reply date for an exact replay and detects mutated approved head',async()=>{
  const original=queryInventory('2026-08-05'),p=await propose('A1',0,original,'QUERY-REPLAY');expect(await propose('A1',0,original,'QUERY-REPLAY')).toEqual(p);
  await expect(propose('A1',0,queryInventory('2026-08-06'),'QUERY-REPLAY')).rejects.toMatchObject({statusCode:409});await review(p);data.get('payrollPaymentEvidence/'+p.id).inventory.events[0].exemption.queryConfirmedOn='2026-08-06';await expect(get()).rejects.toMatchObject({statusCode:409});
 });
 it('records missing-day boundaries as unresolved after independent review',async()=>{const v=queryInventory('2026-07-31'),a=await review(await propose('A1',0,v));expect(a.assessment.issues).toContain('insurer-query-month-end-boundary-unresolved:PAY-1');expect(a.assessment.formalEligibility).toBe('BLOCKED');});
});
