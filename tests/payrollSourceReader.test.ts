import {calculateSalaryForEmployee} from '../netlify/functions/utils/payroll';
import {beforeEach,describe,expect,it} from 'vitest';
import {loadPayrollMonthSource} from '../netlify/functions/utils/payrollSourceReader';
import {seedMasterPayroll} from './fixtures/masterPayroll';
import {employee,month,review,card} from './fixtures/payrollV2';
import {UserRole} from '../types';
import {makePayrollRun} from '../netlify/functions/utils/payrollSnapshot';
import {payrollItemInventoryId} from '../netlify/functions/utils/payrollItems';

// Entirely synthetic. This fake permits reads only through the supplied reader;
// accidental direct SDK reads, transactions or writes fail the test immediately.
const data=new Map<string,any>(),reads:string[]=[];
const clone=(x:any):any=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const forbidden=()=>{throw Error('Canonical source reader attempted a write or bypassed the supplied reader');};
const snapshot=(path:string):any=>({id:path.split('/').pop(),ref:doc(path),exists:data.has(path),data:()=>clone(data.get(path))});
const doc=(path:string):any=>({path,id:path.split('/').pop(),_kind:'doc',get:forbidden,set:forbidden,update:forbidden,delete:forbidden,create:forbidden});
const collection=(path:string,filters:any[]=[],limit=Infinity,order:string|null=null):any=>({path,_kind:'query',filters,_limit:limit,_order:order,
 doc:(id:string)=>doc(path+'/'+id),where:(field:string,op:string,value:any)=>collection(path,[...filters,[field,op,value]],limit,order),limit:(n:number)=>collection(path,filters,n,order),orderBy:(field:string)=>collection(path,filters,limit,field),get:forbidden,add:forbidden});
const db:any={collection,doc,runTransaction:forbidden,batch:forbidden};
const value=(row:any,field:string)=>field==='__name__'?row.id:field.split('.').reduce((v,key)=>v?.[key],row.data());
const reader:any={async get(ref:any){
 reads.push(ref.path);
 if(ref._kind==='doc')return snapshot(ref.path);
 if(ref._kind!=='query')throw Error('Unsupported synthetic reference');
 let docs=[...data.keys()].filter(key=>key.startsWith(ref.path+'/')&&key.split('/').length===ref.path.split('/').length+1).map(snapshot);
 docs=docs.filter(row=>ref.filters.every(([field,op,expected]:any[])=>{const actual=value(row,field);switch(op){case '==':return actual===expected;case 'in':return expected.includes(actual);case '>=':return actual>=expected;case '<=':return actual<=expected;case '>':return actual>expected;case '<':return actual<expected;default:throw Error('Unsupported query operator '+op);}}));
 if(ref._order)docs.sort((a,b)=>String(value(a,ref._order)).localeCompare(String(value(b,ref._order))));
 docs=docs.slice(0,ref._limit);return {docs,size:docs.length,empty:!docs.length};
 },set:forbidden,update:forbidden,delete:forbidden,create:forbidden};
const at='2026-05-02T00:00:00Z';
const load=(time=at)=>loadPayrollMonthSource(db,reader,{month,at:time});
const live=async(time=at)=>{const result=await load(time);expect(result.kind).toBe('live');if(result.kind!=='live')throw Error('Expected synthetic live source');return result;};
function seedInventory(){
 const id=payrollItemInventoryId(employee.id,month),proposedAt='2026-05-01T01:00:00Z',approvedAt='2026-05-01T02:00:00Z';
 const inventory={empId:employee.id,month,mode:'none',sourceRefs:['SYNTHETIC-INVENTORY'],reason:'Synthetic no-other-items evidence',items:[]};
 const proposed={schemaVersion:'payroll-item-inventory-v1',id,empId:employee.id,month,revision:1,status:'proposed',inventory,proposedBy:'ADMIN',proposedAt,history:[{actor:'ADMIN',at:proposedAt,to:'proposed',revision:1,reason:'Synthetic inventory proposal'}],approvalScope:'recorded-evidence-only',applicationStatus:'not-applied',paymentStatus:'not-paid',legalValidation:'unresolved'};
 const approved={...proposed,revision:2,status:'approved',approvedBy:'SECOND',approvedAt,reviewedBy:'SECOND',reviewedAt:approvedAt,history:[...proposed.history,{actor:'SECOND',at:approvedAt,to:'approved',revision:2,reason:'Synthetic independent inventory review'}]};
 data.set('payrollItemInventoryVersions/'+id+'_1',proposed);data.set('payrollItemInventoryVersions/'+id+'_2',approved);data.set('payrollItemInventories/'+id,approved);return {id,proposed,approved};
}
beforeEach(async()=>{
 data.clear();reads.length=0;
 const person={...employee,role:UserRole.Employee,status:'在職',hireDate:'2026-01-01',password:'SYNTHETIC_PASSWORD_NOT_PUBLIC',email:'private@example.test',phone:'SYNTHETIC_PHONE_NOT_PUBLIC',privateContact:'SYNTHETIC_CONTACT_NOT_PUBLIC'};
 data.set('employees/'+employee.id,person);
 for(const id of ['ADMIN','SECOND'])data.set('employees/'+id,{id,role:UserRole.SuperAdmin,accountKind:'system-account',name:'Synthetic reviewer'});
 await seedMasterPayroll((path,value)=>{data.set(path,clone(value));},person,'ADMIN');
 seedInventory();
});

describe('canonical live month reader',()=>{
 it('preserves modern calculation and provenance without writing or using ambient DB reads',async()=>{
  const before=clone([...data]),r=await live(),salary=r.evaluation.salaries.find((s:any)=>s.empId===employee.id);
  expect(salary?.normalPayPreview?.combined).toMatchObject({status:'ready',amount:'1866.67'});
  expect(salary?.insuranceDetail?.status).toBe('ready');expect(salary?.withholdingDetail?.status).toBe('ready');
  const e=r.snapshotInputs.employees.find((e:any)=>e.id===employee.id) as any;
  expect(e.normalPayDays).toHaveLength(30);expect(e.normalPayContextDays).toHaveLength(12);expect(e.normalPayCompEvidence).toBeDefined();expect(e.insurancePeriods).toHaveLength(1);expect(e.insuranceSource.versionId).toBe('CANON_INS');
  expect(r.comparisons[employee.id].sources).toEqual(expect.arrayContaining([expect.objectContaining({kind:'insurance-timeline',id:'CANON_INS'}),expect.objectContaining({kind:'payroll-item-inventory',id:payrollItemInventoryId(employee.id,month),version:'2'})]));
  expect(r.evaluation.status).toBe('BLOCKED');expect(r.comparisons[employee.id]).toMatchObject({formalEligibility:'BLOCKED',applicationStatus:'not-applied',paymentStatus:'not-paid'});
  expect(r.sourceEvidence).toMatchObject({schemaVersion:'payroll-source-evidence-v1',sourceHash:r.sourceHash});expect(r.sourceEvidence.itemInventories).toBeDefined();expect([...data]).toEqual(before);
 });
 it.each([undefined,'invalid-date'])('retains unresolved employee cards instead of filtering them away: %s',date=>{
  data.set('clockRecords/UNKNOWN',{...card(),id:'UNKNOWN',date,clockInAt:'2026-04-01T08:00:00+08:00',clockOutAt:'2026-04-01T09:00:00+08:00'});
  return live().then(r=>{expect(r.snapshotInputs.records.some((c:any)=>c.id==='UNKNOWN')).toBe(true);expect(r.evaluation.trialStatus).not.toBe('READY');expect(r.comparisons[employee.id].totals.net).toBeNull();});
 });
 it('materializes empty and template-backed days consistently without inventing staffed shifts',async()=>{
  const empty=await live();expect(empty.snapshotInputs.schedules).toHaveLength(30);expect(empty.snapshotInputs.schedules.find((s:any)=>s.date==='2026-04-02')?.shifts).toEqual([]);
  data.set('scheduleTemplate/4',{status:'營運',openingHours:'09:00–17:00',requiredHeadcount:2,shifts:[{empId:employee.id,from:'09:00',to:'17:00'}]});
  const templated=await live(),day=templated.snapshotInputs.schedules.find((s:any)=>s.date==='2026-04-02');expect(day).toMatchObject({status:'營運',openingHours:'09:00–17:00',shifts:[]});
  expect(templated.evaluation.salaries[0].normalPayPreview).toEqual(empty.evaluation.salaries[0].normalPayPreview);expect(templated.sourceHash).not.toBe(empty.sourceHash);
 });
 it('hashes meaningful source changes but not a read clock tick',async()=>{
  const initial=await live(),later=await live('2026-05-03T00:00:00Z');expect(later.sourceHash).toBe(initial.sourceHash);
  data.set('makeupRequests/PENDING',{id:'PENDING',empId:employee.id,date:'2026-04-01',status:'待審核',reason:'Synthetic pending correction'});
  const changed=await live();expect(changed.sourceHash).not.toBe(initial.sourceHash);expect(changed.sourceEvidence.requests.makeupRequests).toEqual(expect.arrayContaining([expect.objectContaining({id:'PENDING'})]));
  expect(changed.evaluation.trialStatus).not.toBe('READY');
 });
 it('carries case and revision evidence into the full source identity',async()=>{
  const initial=await live();data.set('attendanceCases/OPEN',{id:'OPEN',empId:employee.id,status:'open',observation:{window:{start:0,end:99999999999}}});data.set('attendanceRevisions/REV',{id:'REV',recordId:'C1',before:{empId:employee.id},after:{empId:employee.id},reason:'Synthetic revision'});
  const changed=await live();expect(changed.sourceHash).not.toBe(initial.sourceHash);expect(changed.sourceEvidence.cases.some((c:any)=>c.id==='OPEN')).toBe(true);expect(changed.sourceEvidence.revisions.some((r:any)=>r.id==='REV')).toBe(true);expect(changed.sourceEvidence.caseEvidence[employee.id]).toBeDefined();
 });
 it('never exposes authentication or contact fields in comparison or calculation snapshot inputs',async()=>{const r=await live();const publicText=JSON.stringify(r.comparisons),snapshotText=JSON.stringify(r.snapshotInputs);for(const secret of ['SYNTHETIC_PASSWORD_NOT_PUBLIC','private@example.test','SYNTHETIC_PHONE_NOT_PUBLIC','SYNTHETIC_CONTACT_NOT_PUBLIC']){expect(publicText).not.toContain(secret);expect(snapshotText).not.toContain(secret);}});
 it('archives scoped attendance evidence without raw verification or unrelated history',async()=>{
  data.set('clockRecords/C1',{...data.get('clockRecords/C1'),verificationData:'SYNTHETIC_GPS_PRIVATE',privateContact:'SYNTHETIC_CARD_CONTACT'});
  data.set('clockRecords/OLD',{...card('2025-01-01'),id:'OLD',notes:'SYNTHETIC_OLD_PRIVATE'});
  data.set('clockRecords/OTHER',{...card(),id:'OTHER',empId:'OTHER',notes:'SYNTHETIC_OTHER_PRIVATE'});
  data.set('leaveRequests/PRIVATE',{id:'PRIVATE',empId:employee.id,startDate:month+'-02',endDate:month+'-03',status:'待審核',leaveType:'事假',hours:8,reason:'SYNTHETIC_MEDICAL_PRIVATE',attachments:[{url:'SYNTHETIC_ATTACHMENT_PRIVATE'}]});
  const before=clone([...data]),r=await live();
  expect(r.snapshotInputs.records.map(c=>c.id)).toEqual(['C1']);
  expect(r.snapshotInputs.leaves.find(l=>l.id==='PRIVATE')).toMatchObject({status:'待審核',hours:8});
  const persisted=JSON.stringify({inputs:r.snapshotInputs,evidence:r.sourceEvidence,comparisons:r.comparisons});
  for(const privateValue of ['SYNTHETIC_GPS_PRIVATE','SYNTHETIC_CARD_CONTACT','SYNTHETIC_OLD_PRIVATE','SYNTHETIC_OTHER_PRIVATE','SYNTHETIC_MEDICAL_PRIVATE','SYNTHETIC_ATTACHMENT_PRIVATE'])expect(persisted).not.toContain(privateValue);
  expect(r.sourceEvidence.rawAttendanceDigests).toMatchObject({records:expect.any(String),leaves:expect.any(String)});expect([...data]).toEqual(before);
  data.get('clockRecords/OLD').clockOutTime='19:00';expect((await live()).sourceHash).not.toBe(r.sourceHash);
 });
 it('retains full adjacent-week and malformed-date records without narrowing calculation inputs',async()=>{
  for(const [id,date] of [['BEFORE','2026-03-26'],['AFTER','2026-05-06'],['UNKNOWN','invalid-date']])data.set('clockRecords/'+id,{...card(date),id,notes:'Synthetic boundary evidence'});
  const r=await live();expect(r.snapshotInputs.records.map(c=>c.id)).toEqual(['AFTER','BEFORE','C1','UNKNOWN']);
  expect((r.snapshotInputs.records.find(c=>c.id==='BEFORE') as any).notes).toBe('Synthetic boundary evidence');
  expect(r.evaluation.trialStatus).not.toBe('READY');
 });
 it('distinguishes missing inventory and invalidates identity for pending replacement',async()=>{
  const confirmed=await live(),{id,approved}=seedInventory();
  const pending={...approved,revision:3,status:'proposed',proposedBy:'ADMIN',proposedAt:'2026-05-02T00:00:00Z',history:[...approved.history,{actor:'ADMIN',at:'2026-05-02T00:00:00Z',to:'proposed',revision:3,reason:'Synthetic replacement inventory'}]};
  for(const key of ['approvedBy','approvedAt','reviewedBy','reviewedAt'])delete (pending as any)[key];data.set('payrollItemInventories/'+id,pending);data.set('payrollItemInventoryVersions/'+id+'_3',pending);
  const replaced=await live();expect(replaced.sourceHash).not.toBe(confirmed.sourceHash);expect(replaced.comparisons[employee.id].inventoryStatus).toBe('unreviewed');
  for(const path of [...data.keys()])if(path.startsWith('payrollItemInventor'))data.delete(path);
  const missing=await live();expect(missing.comparisons[employee.id].inventoryStatus).toBe('missing');expect(missing.comparisons[employee.id].totals.net).toBeNull();
 });
 it('does not trust an inventory head whose immutable proposal is missing',async()=>{const id=payrollItemInventoryId(employee.id,month);data.delete('payrollItemInventoryVersions/'+id+'_1');const before=clone([...data]);await expect(load()).rejects.toMatchObject({statusCode:409});expect([...data]).toEqual(before);});
});

describe('locked source replay',()=>{
 async function lockExisting(){const current=await live();
  // A historical fixture predates whole-month preflight; construct its original
  // calculation inputs without pretending today's unresolved scan is approved.
  const oldSalaries=current.snapshotInputs.employees.map(e=>calculateSalaryForEmployee(e,month,current.snapshotInputs.schedules,current.snapshotInputs.records,current.snapshotInputs.leaves));
  expect(oldSalaries.every(s=>s.calculationStatus==='ready')).toBe(true);
  const run=makePayrollRun('SYNTHETIC-RUN',month,review.reviewedAt,oldSalaries,current.snapshotInputs);const lock={yearMonth:month,payrollRunId:run.id,lockedAt:review.reviewedAt,lockedBy:'ADMIN',lockedByName:'Synthetic reviewer',totalAmount:1866.67,employeeCount:1};data.set('payrollRuns/'+run.id,clone(run));data.set('monthLocks/'+month,lock);return {run,lock};}
 it('replays an old run without relabeling its four-input hash as complete preflight proof',async()=>{
  const {run}=await lockExisting();data.set('employees/'+employee.id,{id:employee.id,monthlySalary:999999,password:'NEW_PRIVATE_PASSWORD'});data.delete('clockRecords/C1');reads.length=0;
  const r=await load();expect(r.kind).toBe('locked');if(r.kind!=='locked')throw Error('Expected locked replay');expect(r.run).toEqual(run);expect(r.salaries).toEqual(run.salaries);expect(r.originalInputHash).toBe(run.inputHash);expect(r.sourceHash).toBeNull();expect(r.completeness).toBe('legacy-inputs-only');expect(reads).toEqual(['monthLocks/'+month,'payrollRuns/'+run.id]);expect(data.get('payrollRuns/'+run.id)).toEqual(run);
 });
 it.each(['missing-run','wrong-month','wrong-id','changed-input-hash','changed-inputs','duplicate-employee','wrong-employee','wrong-salary-month'])('holds invalid historical authority without reconstructing original salary: %s',async kind=>{
  const {run}=await lockExisting(),path='payrollRuns/'+run.id;
  if(kind==='missing-run')data.delete(path);else{const stored=data.get(path);if(kind==='wrong-month')stored.yearMonth='2026-05';if(kind==='wrong-id')stored.id='OTHER';if(kind==='changed-input-hash')stored.inputHash='bad';if(kind==='changed-inputs')stored.inputs.employees[0].hourlyRate=999;if(kind==='duplicate-employee')stored.salaries.push(clone(stored.salaries[0]));if(kind==='wrong-employee')stored.salaries[0].empId='OTHER';if(kind==='wrong-salary-month')stored.salaries[0].yearMonth='2026-05';}
  const before=clone([...data]);reads.length=0;const r=await load();expect(r.kind).toBe('legacy-locked');if(r.kind!=='legacy-locked')throw Error('Expected blocked legacy source');expect(r.issues.length).toBeGreaterThan(0);expect(reads).not.toContain('employees');expect([...data]).toEqual(before);
 });
 it('keeps a lock without a run reference unresolved and read-only',async()=>{data.set('monthLocks/'+month,{yearMonth:month,lockedAt:review.reviewedAt,lockedBy:'ADMIN'});reads.length=0;const r=await load();expect(r.kind).toBe('legacy-locked');expect(reads).not.toContain('employees');});
});


describe('explicit unlock authority before live source reads',()=>{
 const validUnlock=()=>({yearMonth:month,lockedAt:'2026-05-01T00:00:00Z',lockedBy:'ADMIN',unlockedAt:'2026-05-02T00:00:00Z',unlockedBy:'SECOND',unlockReason:'Synthetic reviewed reopening'});
 it.each([
  {yearMonth:month,unlockedAt:'garbage'},
  {yearMonth:'2026-05',unlockedAt:true},
  {yearMonth:'2026-05'},
  {...validUnlock(),unlockedAt:true},
  {...validUnlock(),unlockedAt:null},
  {...validUnlock(),unlockedAt:''},
  {...validUnlock(),unlockedAt:'2026-02-30T00:00:00Z'},
  {...validUnlock(),unlockedAt:'2026-04-30T00:00:00Z'},
  {...validUnlock(),unlockedBy:undefined},
  {...validUnlock(),unlockedBy:'   '},
  {...validUnlock(),unlockReason:undefined},
  {...validUnlock(),unlockReason:'   '},
  {...validUnlock(),lockedAt:undefined},
  {...validUnlock(),lockedBy:undefined},
 ])('rejects malformed lock scope or unlock authority without reading employees: %j',async lock=>{
  data.set('monthLocks/'+month,lock);reads.length=0;
  await expect(load()).rejects.toMatchObject({statusCode:409});
  expect(reads).toEqual(['monthLocks/'+month]);
 });
 it('permits live source loading after an explicitly recorded valid unlock',async()=>{
  data.set('monthLocks/'+month,validUnlock());reads.length=0;
  expect((await load()).kind).toBe('live');expect(reads).toContain('employees');
 });
});
