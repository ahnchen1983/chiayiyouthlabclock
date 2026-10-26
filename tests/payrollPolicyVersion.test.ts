import {describe,it,expect,beforeEach} from 'vitest';
import {UserRole} from '../types';
import {handlePayrollPolicyAction,buildNormalPayPolicy} from '../netlify/functions/utils/payrollPolicyVersion';
import {calculateNormalPay} from '../utils/payroll/normalPay';
import {normalDays} from './fixtures/normalPay';
// Synthetic accounts only.
const data=new Map<string,any>();
const clone=(x:any)=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const doc=(path:string):any=>({path,id:path.split('/').pop(),async get(){return {id:path.split('/').pop(),exists:data.has(path),data:()=>clone(data.get(path))};}});
const collection=(path:string,filters:any[]=[],limit=Infinity):any=>({doc:(id:string)=>doc(path+'/'+id),where:(f:string,_:string,v:any)=>collection(path,[...filters,[f,v]],limit),limit:(n:number)=>collection(path,filters,n),
 async get(){const docs=[...data.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===2).map(k=>({id:k.split('/')[1],data:()=>clone(data.get(k))})).filter(d=>filters.every(([f,v])=>d.data()[f]===v)).slice(0,limit);return {docs,size:docs.length};}});
const db:any={collection,async runTransaction(fn:any){const writes:any[]=[];let wrote=false;const tx:any={get:async(r:any)=>{if(wrote)throw Error('read after write');return r.get();}};for(const m of ['set','create'])tx[m]=(r:any,v:any)=>{wrote=true;writes.push([m,r,v]);};const result=await fn(tx);for(const [m,r,v] of writes){if(m==='create'&&data.has(r.path))throw Error('exists');data.set(r.path,clone(v));}return result;}};
let n=0;const op=()=>'op-'+(++n);
const act=(uid:string,action:string,body:any={})=>handlePayrollPolicyAction(db,uid,action,body);
const code=async(p:Promise<any>)=>{try{await p;return 0;}catch(e:any){return e.statusCode;}};
const propose=(uid='A1',extra:any={})=>act(uid,'propose-payroll-policy-version',{operationId:op(),employeeIds:['E1','E2'],from:'2026-08-01',to:'2026-12-31',otherLeave:null,reason:'建立八月起計薪政策',...extra});
beforeEach(()=>{data.clear();data.set('employees/E1',{id:'E1',role:UserRole.Employee});data.set('employees/E2',{id:'E2',role:UserRole.Employee});data.set('employees/A1',{id:'A1',role:UserRole.Admin});data.set('employees/A2',{id:'A2',role:UserRole.SuperAdmin});data.set('employees/SYS',{id:'SYS',role:UserRole.SuperAdmin,accountKind:'system-account'});});
describe('server-built policy content',()=>{
 it('passes the normal-pay engine validation and pays a full month exactly once rounded',()=>{const p=buildNormalPayPolicy('v','A2','2026-07-01T00:00:00Z',null);const days=normalDays('2026-08').map(d=>({...d,policy:p as any}));const r=calculateNormalPay('S','2026-08',days,[]);expect(r.status,r.issues.join()).toBe('ready');expect(r.amount).toBe('30000');});
 it('encodes the confirmed rules: Sunday week, final integer half-up, statutory leave pay',()=>{const p:any=buildNormalPayPolicy('v','A2','2026-07-01T00:00:00Z','paid');expect(p.overtimeRules.weekStartDay).toBe(0);expect(p.rounding).toMatchObject({stage:'final',precision:0,mode:'half-up'});expect(p.leavePaidFractions).toMatchObject({'特休':{numerator:1,denominator:1},'事假':{numerator:0,denominator:1},'病假':{numerator:1,denominator:2},'其他':{numerator:1,denominator:1}});expect(p.workRegime).toBe('standard-8-40');expect(p.monthlyStrategy).toBe('calendar-earned');});
 it('an undecided "other" leave stays absent so such leave is held, not paid at 0',()=>{expect((buildNormalPayPolicy('v','A2','2026-07-01T00:00:00Z',null) as any).leavePaidFractions['其他']).toBeUndefined();});
});
describe('two-person flow',()=>{
 it('one admin proposes, a different admin approves into an immutable version',async()=>{const p=await propose();expect(p.status).toBe('proposed');expect(data.size).toBeGreaterThan(0);
  expect(await code(act('A1','review-payroll-policy-version',{operationId:op(),proposalId:p.id,expectedRevision:1,mode:'approve',reason:'自己核定測試'}))).toBe(403);
  const r=await act('A2','review-payroll-policy-version',{operationId:op(),proposalId:p.id,expectedRevision:1,mode:'approve',reason:'核定計薪政策'});expect(r.status).toBe('approved');
  const v=data.get('payrollPolicyVersions/'+r.versionId);expect(v).toMatchObject({status:'approved',approvedBy:'A2',proposedBy:'A1',employeeIds:['E1','E2'],from:'2026-08-01',to:'2026-12-31'});expect(v.normalPay.version).toBe(r.versionId);
  expect(await code(act('A2','review-payroll-policy-version',{operationId:op(),proposalId:p.id,expectedRevision:2,mode:'approve',reason:'重複核定測試'}))).toBe(409);});
 it('employees cannot propose; system accounts and unknown employees cannot be covered',async()=>{expect(await code(propose('E1'))).toBe(403);expect(await code(propose('A1',{employeeIds:['SYS']}))).toBe(400);expect(await code(propose('A1',{employeeIds:['NOPE']}))).toBe(400);});
 it('invalid periods, other-leave values and short reasons are refused',async()=>{expect(await code(propose('A1',{from:'2026-12-31',to:'2026-08-01'}))).toBe(400);expect(await code(propose('A1',{otherLeave:'double'}))).toBe(400);expect(await code(propose('A1',{reason:'短'}))).toBe(400);});
 it('replay returns the same proposal; changed content under the same id fails',async()=>{const body={operationId:'same',employeeIds:['E1'],from:'2026-08-01',to:'2026-08-31',otherLeave:null,reason:'建立八月計薪政策'};const a=await act('A1','propose-payroll-policy-version',body);expect((await act('A1','propose-payroll-policy-version',body)).id).toBe(a.id);expect(await code(act('A1','propose-payroll-policy-version',{...body,to:'2026-09-30'}))).toBe(409);});
 it('return keeps history and no version is created',async()=>{const p=await propose();const r=await act('A2','review-payroll-policy-version',{operationId:op(),proposalId:p.id,expectedRevision:1,mode:'return',reason:'期間需調整'});expect(r.status).toBe('returned');expect([...data.keys()].some(k=>k.startsWith('payrollPolicyVersions/'))).toBe(false);});
 it('admins list versions and proposals; employees cannot',async()=>{await propose();expect((await act('A1','list-payroll-policy-versions')).proposals).toHaveLength(1);expect(await code(act('E1','list-payroll-policy-versions'))).toBe(403);});
});
