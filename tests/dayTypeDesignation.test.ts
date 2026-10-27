import {describe,it,expect,beforeEach} from 'vitest';
import {UserRole} from '../types';
import {handleDayTypeAction} from '../netlify/functions/utils/dayTypeDesignation';
import {effectiveMasterForMonth,PERSONAL_MONTHLY_CALENDAR} from '../netlify/functions/utils/effectiveMaster';
import {designationWarnings,parseMonthDates,designationDays} from '../utils/dayTypeDesignation';
import {normalPolicy} from './fixtures/normalPay';
// Synthetic only: no real roster, no company calendar is implied by these dates.
const data=new Map<string,any>();
const clone=(x:any)=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const doc=(path:string):any=>({path,id:path.split('/').pop(),async get(){return {id:path.split('/').pop(),exists:data.has(path),data:()=>clone(data.get(path))};},async set(v:any){data.set(path,clone(v));}});
const collection=(path:string,filters:any[]=[],limit=Infinity):any=>({doc:(id:string)=>doc(path+'/'+id),where:(f:string,_:string,v:any)=>collection(path,[...filters,[f,v]],limit),limit:(n:number)=>collection(path,filters,n),
 async get(){const docs=[...data.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===2).map(k=>({id:k.split('/')[1],data:()=>clone(data.get(k))})).filter(d=>filters.every(([f,v])=>d.data()[f]===v)).slice(0,limit);return {docs,size:docs.length};}});
const db:any={collection,async runTransaction(fn:any){const writes:any[]=[];let wrote=false;const tx:any={get:async(r:any)=>{if(wrote)throw Error('read after write');return r.get();}};for(const m of ['set','create'])tx[m]=(r:any,v:any)=>{wrote=true;writes.push([m,r,v]);};const result=await fn(tx);for(const [m,r,v] of writes){if(m==='create'&&data.has(r.path))throw Error('exists');data.set(r.path,clone(v));}return result;}};
const M='2026-08',reg=['2026-08-02','2026-08-09','2026-08-16','2026-08-23','2026-08-30'],rest=['2026-08-01','2026-08-08','2026-08-15','2026-08-22','2026-08-29'];
let n=0;const op=()=>'op-'+(++n);
const act=(uid:string,action:string,body:any={})=>handleDayTypeAction(db,uid,action,{yearMonth:M,...body});
const submit=(uid='EMP',extra:any={})=>act(uid,'submit-daytype-designation',{operationId:op(),expectedRevision:0,regularHolidays:reg,restDays:rest,...extra});
const approve=(uid='REV',extra:any={})=>act(uid,'review-daytype-designation',{empId:'EMP',operationId:op(),expectedRevision:1,mode:'approve',reason:'核對八月班表',confirmRemainingNormal:true,...extra});
const code=async(p:Promise<any>)=>{try{await p;return 0;}catch(e:any){return e.statusCode;}};
beforeEach(()=>{data.clear();data.set('employees/EMP',{id:'EMP',role:UserRole.Employee});data.set('employees/REV',{id:'REV',role:UserRole.Admin});data.set('employees/REV2',{id:'REV2',role:UserRole.SuperAdmin});data.set('employees/SYS',{id:'SYS',role:UserRole.SuperAdmin,accountKind:'system-account'});});
describe('pure designation rules',()=>{
 it('rejects foreign-month, duplicate and malformed dates instead of coercing',()=>{expect(parseMonthDates(['2026-09-01'],M,'例假')).toContain('非本月');expect(parseMonthDates(['2026-08-01','2026-08-01'],M,'例假')).toContain('重複');expect(parseMonthDates('2026-08-01',M,'例假')).toContain('格式');});
 it('a weekly 1+1 pattern has no warnings; missing rest days warn about consecutive work',()=>{expect(designationWarnings(M,reg,rest)).toEqual([]);const w=designationWarnings(M,reg,[]);expect(w.join()).toContain('未指定任何休息日');expect(designationWarnings(M,reg,['2026-08-01']).join()).toContain('連續7日沒有休息日');expect(designationWarnings(M,['2026-08-15'],['2026-08-16']).join()).toContain('連續');});
 it('every date gets exactly one type',()=>{const d=designationDays(M,reg,rest,['2026-08-10']);expect(Object.keys(d)).toHaveLength(31);expect(d['2026-08-02']).toBe('regular-holiday');expect(d['2026-08-01']).toBe('rest');expect(d['2026-08-10']).toBe('national-holiday');expect(d['2026-08-03']).toBe('normal');});
});
describe('submit and two-person review',()=>{
 it('employee submits own designation; another admin approves into an immutable calendar version',async()=>{
  const s=await submit();expect(s.status).toBe('submitted');expect(s.revision).toBe(1);expect(data.has('dayTypeCalendarHeads/EMP_2026-08')).toBe(false);
  const r=await approve();expect(r.status).toBe('approved');const head=data.get('dayTypeCalendarHeads/EMP_2026-08');expect(head.currentCalendarId).toBe(r.calendarId);
  const c=data.get('dayTypeCalendars/'+r.calendarId);expect(c).toMatchObject({status:'approved',yearMonth:M,employeeIds:['EMP'],approvedBy:'REV'});expect(c.days['2026-08-02']).toBe('regular-holiday');expect(c.source).toMatchObject({designationRevision:1,submittedBy:'EMP',onBehalf:false});
 });
 it('self approval, approving own on-behalf submission, and non-admin review are refused',async()=>{
  await submit();expect(await code(approve('EMP'))).toBe(403);
  data.clear();beforeEachSeed();await submit('REV',{empId:'EMP',reason:'依紙本補錄八月'});expect(await code(approve('REV'))).toBe(403);expect((await approve('REV2')).status).toBe('approved');
 });
 it('on-behalf entry needs an admin and a reason; employees cannot write for others',async()=>{expect(await code(submit('REV',{empId:'EMP'}))).toBe(403);data.set('employees/EMP2',{id:'EMP2',role:UserRole.Employee});expect(await code(submit('EMP2',{empId:'EMP',reason:'代填測試原因'}))).toBe(403);});
 it('overlap, stale revision, replay with different content and system accounts fail closed',async()=>{
  expect(await code(submit('EMP',{restDays:[reg[0]]}))).toBe(400);
  const opId='same';await act('EMP','submit-daytype-designation',{operationId:opId,expectedRevision:0,regularHolidays:reg,restDays:rest});
  expect((await act('EMP','submit-daytype-designation',{operationId:opId,expectedRevision:0,regularHolidays:reg,restDays:rest})).revision).toBe(1);
  expect(await code(act('EMP','submit-daytype-designation',{operationId:opId,expectedRevision:0,regularHolidays:reg,restDays:[]}))).toBe(409);
  expect(await code(submit('EMP',{expectedRevision:0}))).toBe(409);
  expect(await code(act('SYS','submit-daytype-designation',{operationId:op(),expectedRevision:0,regularHolidays:reg,restDays:rest}))).toBe(409);
 });
 it('approval requires explicit remaining-normal confirmation, warning acknowledgement and no national overlap',async()=>{
  await submit('EMP',{restDays:[]});expect(await code(approve('REV',{confirmRemainingNormal:false}))).toBe(400);expect(await code(approve('REV'))).toBe(400);
  expect(await code(approve('REV',{acknowledgeWarnings:true,nationalHolidays:[reg[0]]}))).toBe(409);
  const r=await approve('REV',{acknowledgeWarnings:true});expect(data.get('dayTypeCalendars/'+r.calendarId).acknowledgedWarnings).toBe(true);
 });
 it('return keeps the previous approved calendar effective; resubmission does not move the head',async()=>{
  await submit();const first=await approve();await submit('EMP',{expectedRevision:2,restDays:rest.slice(1)});expect(data.get('dayTypeCalendarHeads/EMP_2026-08').currentCalendarId).toBe(first.calendarId);
  const ret=await act('REV','review-daytype-designation',{empId:'EMP',operationId:op(),expectedRevision:3,mode:'return',reason:'週期需再核對'});expect(ret.status).toBe('returned');expect(data.get('dayTypeCalendarHeads/EMP_2026-08').currentCalendarId).toBe(first.calendarId);
 });
 it('locked months refuse new designations (423)',async()=>{data.set('monthLocks/2026-08',{yearMonth:M,lockedAt:'2026-09-05T00:00:00Z',lockedBy:'REV'});expect(await code(submit())).toBe(423);});
 it('employees read only their own month; admins can list',async()=>{await submit();expect(await code(act('EMP','list-daytype-designations'))).toBe(403);expect((await act('REV','list-daytype-designations')).designations).toHaveLength(1);data.set('employees/EMP2',{id:'EMP2',role:UserRole.Employee});expect(await code(act('EMP2','get-daytype-designation',{empId:'EMP'}))).toBe(403);expect((await act('EMP','get-daytype-designation')).designation.status).toBe('submitted');});
});
function beforeEachSeed(){data.set('employees/EMP',{id:'EMP',role:UserRole.Employee});data.set('employees/REV',{id:'REV',role:UserRole.Admin});data.set('employees/REV2',{id:'REV2',role:UserRole.SuperAdmin});}
describe('effective master resolves personal-monthly calendars',()=>{
 const seedMaster=()=>{const at='2026-07-01T00:00:00Z';data.set('payrollMasterHeads/EMP',{currentVersionId:'V',revision:1});data.set('payrollMasterVersions/V',{empId:'EMP',status:'approved',approvedBy:'REV2',approvedAt:at,timeline:{accountKind:'employee',from:'2026-08-01',to:'2026-08-31',periods:[{from:'2026-08-01',to:'2026-08-31',employmentState:'active',employmentType:'full-time',payBasis:'monthly',amount:30000,policyVersionId:'P',dayTypeCalendarId:PERSONAL_MONTHLY_CALENDAR}]}});data.set('payrollPolicyVersions/P',{status:'approved',version:'pv',approvedBy:'REV2',approvedAt:at,employeeIds:['EMP'],from:'2026-08-01',to:'2026-08-31',normalPay:normalPolicy()});};
 const effective=()=>effectiveMasterForMonth(db,null,{id:'EMP',payrollReview:{policy:{version:'pv'}}},M,{masterVersionId:'V'});
 it('without an approved designation the day type stays pending, never normal',async()=>{seedMaster();await submit();const e=await effective();expect(e.masterAssessment.issues).toContain('日期日別參照未核定');expect(e.normalPayDays.every((d:any)=>d.dayType==='unknown')).toBe(true);});
 it('after approval each date carries the designated type',async()=>{seedMaster();await submit();await approve();const e=await effective();expect(e.masterAssessment.issues).not.toContain('日期日別參照未核定');const t=Object.fromEntries(e.normalPayDays.map((d:any)=>[d.date,d.dayType]));expect(t['2026-08-02']).toBe('regular-holiday');expect(t['2026-08-01']).toBe('rest');expect(t['2026-08-03']).toBe('normal');});
 it('a calendar from another month behind a tampered head is not accepted',async()=>{seedMaster();await submit();const r=await approve();const c=data.get('dayTypeCalendars/'+r.calendarId);data.set('dayTypeCalendars/'+r.calendarId,{...c,yearMonth:'2026-07'});const e=await effective();expect(e.masterAssessment.issues).toContain('日期日別參照未核定');});
});
