import {beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('../netlify/functions/utils/payrollSourceReader',()=>({loadPayrollMonthSource:vi.fn()}));
import {loadPayrollMonthSource} from '../netlify/functions/utils/payrollSourceReader';
import {handleHistoricalPayrollDifferenceAction as handle} from '../netlify/functions/utils/historicalPayrollDifference';
import {UserRole} from '../types';
import {evidenceHash} from '../netlify/functions/utils/attendanceCaseLifecycle';

const empId='SYNTH',month='2026-08',clone=(v:any):any=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const data=new Map<string,any>(),writes:string[]=[];
const doc=(path:string):any=>({path});
const db:any={collection:(name:string)=>({doc:(id:string)=>doc(name+'/'+id)}),async runTransaction(fn:any){
 const pending:any[]=[];let wrote=false;
 const tx:any={async get(ref:any){if(wrote)throw Error('read-after-write');return {exists:data.has(ref.path),data:()=>clone(data.get(ref.path))};}};
 for(const mode of ['create','set'])tx[mode]=(ref:any,value:any)=>{wrote=true;pending.push({mode,path:ref.path,value:clone(value)});};
 const result=await fn(tx);for(const p of pending)if(p.mode==='create'&&data.has(p.path))throw Error('exists');
 for(const p of pending){data.set(p.path,p.value);writes.push(p.path);}return result;
}};
let loaded:any,sequence=0;
const salary=()=>({empId,yearMonth:month,calculationStatus:'locked',calculationVersion:'synthetic-old',baseSalary:1000,overtimePay:0,compSettlementPay:0,laborInsurance:0,healthInsurance:100,laborPensionSelf:0,leaveDeduction:0,incomeTax:0,supplementaryPremium:0,grossSalary:1000,totalDeductions:100,netSalary:900});
const codes=[['normal','earning','1000'],['overtime','earning','0'],['comp-settlement','earning','0'],['insurance:labor-employment','deduction','0'],['insurance:health','deduction','100'],['pension:self','deduction','0'],['leave','deduction','0'],['tax:income','deduction','0'],['health:supplementary','deduction','0']];
const actual=()=>({currency:'TWD',items:codes.map(([sourceCode,kind,amount])=>({sourceCode,kind,amount,sourceRefs:['SYNTHETIC-LINE'],reason:'Synthetic recorded item evidence'})),netAmount:'900',sourceRefs:['SYNTHETIC-NET'],reason:'Synthetic recorded payment evidence'});
const command=(extra:any={})=>({empId,month,expectedRevision:0,operationId:'op-'+(++sequence),reason:'Synthetic independent historical evidence',...extra});
const propose=(extra:any={},uid='A1')=>handle(db,uid,'propose-historical-payroll-difference',command({actual:actual(),...extra}));
const review=(p:any,extra:any={},uid='A2')=>handle(db,uid,'review-historical-payroll-difference',command({expectedRevision:p.revision,mode:'approve',...extra}));
const adopt=(p:any,extra:any={},uid='A2')=>handle(db,uid,'adopt-historical-payroll-difference',command({expectedRevision:p.revision,...extra}));
beforeEach(()=>{
 data.clear();writes.length=0;sequence=0;
 for(const id of ['A1','A2','A3'])data.set('employees/'+id,{role:UserRole.SuperAdmin});data.set('employees/'+empId,{role:UserRole.Employee});
 const lock={yearMonth:month,payrollRunId:'SYNTH-RUN',lockedBy:'A3',lockedAt:'2026-09-01T00:00:00Z'},s=salary(),run={id:'SYNTH-RUN',yearMonth:month,calculationVersion:'synthetic-old',inputHash:'input-hash',inputs:{employees:[],records:[],leaves:[],schedules:[]},salaries:[s]};
 data.set('monthLocks/'+month,clone(lock));data.set('payrollRuns/SYNTH-RUN',clone(run));
 loaded={kind:'locked',run,lock,salaries:[s],originalInputHash:'input-hash',sourceHash:'source-hash',completeness:'complete'};
 vi.mocked(loadPayrollMonthSource).mockReset().mockImplementation(async(_db,reader)=>{expect(reader.get).toBeTypeOf('function');return clone(loaded);});
});
describe('separate locked-month historical comparison evidence',()=>{
 it('records review and separate zero-only adoption without changing original payroll or lock',async()=>{
  const before=clone([data.get('payrollRuns/SYNTH-RUN'),data.get('monthLocks/'+month)]),p=await propose();
  expect(p.original).toMatchObject({status:'recorded',runId:'SYNTH-RUN',inputHash:'input-hash',sourceHash:'source-hash'});
  expect(p.comparison.varianceStatus).toBe('zero');const r=await review(p),a=await adopt(r);
  expect(a).toMatchObject({status:'adoption-recorded',applicationStatus:'not-applied',paymentStatus:'not-paid',formalEligibility:'BLOCKED',legalValidation:'not-certified',comparisonBasis:'original-recorded-payroll'});
  expect([data.get('payrollRuns/SYNTH-RUN'),data.get('monthLocks/'+month)]).toEqual(before);
  expect(writes.every(path=>path.startsWith('historicalPayrollDifference')||path==='payrollControl/revision')).toBe(true);
  expect([...data.keys()].filter(k=>k.startsWith('historicalPayrollDifferenceAdoptions/'))).toHaveLength(1);
 });
 it('allows factual proposal for unavailable original evidence but never approval or invented zeros',async()=>{
  loaded={kind:'legacy-locked',lock:loaded.lock,issues:['missing original']};const p=await propose();
  expect(p.original.status).toBe('unavailable');expect(p.source.lines.every((l:any)=>l.amount===null)).toBe(true);expect(p.comparison.varianceStatus).toBe('unresolved');
  await expect(review(p)).rejects.toMatchObject({statusCode:409});
 });
 it('retains missing legacy components as unresolved and does not recompute from present master data',async()=>{
  loaded.completeness='legacy-inputs-only';loaded.sourceHash=null;delete loaded.salaries[0].incomeTax;
  const p=await propose();expect(p.original.completeness).toBe('legacy-inputs-only');expect(p.source.lines.find((l:any)=>l.code==='tax:income').amount).toBeNull();await expect(review(p)).rejects.toMatchObject({statusCode:409});
 });
 it('blocks both net differences and offsetting item differences from adoption',async()=>{
  const v=actual();v.items[0].amount='1010';v.items[4].amount='110';const p=await propose({actual:v});
  expect(p.comparison.netDelta?.numerator).toBe('0');expect(p.comparison.varianceStatus).toBe('nonzero');const r=await review(p);await expect(adopt(r)).rejects.toMatchObject({statusCode:409});
 });
 it('rejects changed original salary, run metadata or lock identity at review and adoption',async()=>{
  const p=await propose();loaded.run.calculationVersion='changed';await expect(review(p)).rejects.toMatchObject({statusCode:409});loaded.run.calculationVersion='synthetic-old';
  loaded.salaries[0].netSalary=901;await expect(review(p)).rejects.toMatchObject({statusCode:409});loaded.salaries[0].netSalary=900;
  const r=await review(p);loaded.lock.lockedBy='DIFFERENT';await expect(adopt(r)).rejects.toMatchObject({statusCode:409});
 });
 it('rejects unlocked/live sources and does not write a historical case',async()=>{loaded={kind:'live'};await expect(propose()).rejects.toMatchObject({statusCode:409});expect(writes).toEqual([]);});
 it('excludes subject and every historical proposer from independent review/adoption',async()=>{
  const p=await propose();await expect(review(p,{},'A1')).rejects.toMatchObject({statusCode:403});const returned=await review(p,{mode:'return'});
  const next=await propose({expectedRevision:returned.revision},'A3');await expect(review(next,{},'A1')).rejects.toMatchObject({statusCode:403});const r=await review(next);
  data.set('employees/'+empId,{role:UserRole.SuperAdmin});await expect(adopt(r,{},empId)).rejects.toMatchObject({statusCode:403});await expect(adopt(r,{},'A3')).rejects.toMatchObject({statusCode:403});
 });
 it('replays historical results without restoring an old head and rejects altered payload',async()=>{
  const c=command({actual:actual()}),p=await handle(db,'A1','propose-historical-payroll-difference',c),r=await review(p);
  expect(await handle(db,'A1','propose-historical-payroll-difference',c)).toEqual(p);expect(data.get('historicalPayrollDifferenceHeads/'+p.id).revision).toBe(r.revision);
  await expect(handle(db,'A1','propose-historical-payroll-difference',{...c,reason:'Altered historical replay reason'})).rejects.toMatchObject({statusCode:409});
 });
 it('refuses corrupt immutable history, missing adoption evidence, or deleted heads on receipt replay',async()=>{
  const p=await propose(),r=await review(p),c=command({expectedRevision:r.revision}),a=await handle(db,'A2','adopt-historical-payroll-difference',c);
  const path='historicalPayrollDifferenceAdoptions/'+a.adoptionId,record=clone(data.get(path));data.delete(path);
  await expect(handle(db,'A2','adopt-historical-payroll-difference',c)).rejects.toBeDefined();data.set(path,record);data.delete('historicalPayrollDifferenceHeads/'+a.id);
  await expect(handle(db,'A2','adopt-historical-payroll-difference',c)).rejects.toMatchObject({statusCode:409});
 });
 it('unknown actual rows and mismatched net amounts block independent review',async()=>{const v=actual();v.items.pop();v.netAmount='901';const p=await propose({actual:v});await expect(review(p)).rejects.toMatchObject({statusCode:409});});
 it('subject can only read reviewed evidence and cannot see a pending proposal',async()=>{
  const p=await propose();expect((await handle(db,empId,'get-historical-payroll-difference',{empId,month})).current).toBeNull();await review(p);
  expect((await handle(db,empId,'get-historical-payroll-difference',{empId,month})).current.status).toBe('reviewed');
 });
 it('binds source digests without exposing original employee or unrelated raw input data',async()=>{
  loaded.run.inputs.employees=[{id:empId,privateContact:'SYNTHETIC_PRIVATE_CONTACT'}];const p=await propose();expect(JSON.stringify(p)).not.toContain('SYNTHETIC_PRIVATE_CONTACT');expect(p.original.runHash).toBe(evidenceHash(loaded.run));
 });
 it.each([{source:{}},{original:{}},{applicationStatus:'applied'},{caseId:'recovery'}])('rejects client-owned authority fields %#',extra=>expect(propose(extra)).rejects.toMatchObject({statusCode:400}));
});
