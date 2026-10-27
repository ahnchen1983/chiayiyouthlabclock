import {describe,it,expect,vi} from 'vitest';
import {UserRole} from '../types';
import {caseKey,evidenceHash} from '../netlify/functions/utils/attendanceCaseLifecycle';
import type {CaseObservation} from '../netlify/functions/utils/attendanceCaseTypes';
const state=vi.hoisted(()=>({observations:[] as any[],tx:null as any,locks:[] as string[]}));
vi.mock('../netlify/functions/utils/attendanceCaseEvidence',async importOriginal=>({...await importOriginal<any>(),
 loadAttendanceCaseInput:async()=>({synthetic:true}),scanCaseObservations:()=>({observations:state.observations,missingCapabilities:['policy']})}));
vi.mock('../netlify/functions/utils/monthGuard',()=>({
 runPayrollMutation:async(_db:any,_months:string[],fn:any)=>fn(state.tx),
 monthsInRange:(first:string,last:string)=>[...new Set([first.slice(0,7),last.slice(0,7)])],
 assertTransactionMonths:async(_db:any,tx:any,months:string[])=>{state.locks=months;for(const m of months)await tx.get({path:'monthLocks/'+m});},
}));
import {handleAttendanceCaseAction} from '../netlify/functions/utils/attendanceCaseService';
const empId='SYNTH-service',month='2026-04',uid='SYNTH-admin';
function setup(){
 const docs=new Map<string,any>([['employees/'+uid,{role:UserRole.Admin}]]),log:string[]=[];
 const collection=(name:string)=>({doc:(id:string)=>({path:name+'/'+id}),where:(key:string,valueOp:string,value:string)=>({limit:()=>({name,key,value})}),limit:()=>({name})});
 const db={collection};
 state.tx={get:async(ref:any)=>{
  log.push('read:'+(ref.path||ref.name));
  if(ref.path)return {exists:docs.has(ref.path),data:()=>structuredClone(docs.get(ref.path))};
  const rows=[...docs].filter(([path,row])=>path.startsWith(ref.name+'/')&&(!ref.key||row[ref.key]===ref.value)).map(([path,row])=>({id:path.split('/').at(-1),data:()=>structuredClone(row)}));return {size:rows.length,docs:rows};
 },set:(ref:any,value:any)=>{log.push('write:'+ref.path);docs.set(ref.path,structuredClone(value));},create:(ref:any,value:any)=>{if(docs.has(ref.path))throw new Error('exists');log.push('write:'+ref.path);docs.set(ref.path,structuredClone(value));}};
 const o:CaseObservation={schemaVersion:'attendance-case-v1',detectorVersion:'detector-v1',id:caseKey(empId,'missing-in','card:synthetic'),empId,type:'missing-in',anchor:'card:synthetic',window:{start:Date.parse('2026-03-31T23:00:00+08:00')/60000,end:Date.parse('2026-04-01T01:00:00+08:00')/60000},outcome:'unknown',reason:'synthetic unknown policy',refs:[],policyVersion:null,payrollDecision:'none',evidenceVersion:evidenceHash('synthetic')};
 state.observations=[o];state.locks=[];
 return {docs,log,db,o,scan:()=>handleAttendanceCaseAction(db,uid,'scan-attendance-cases',{empId,yearMonth:month},()=>new Date('2026-05-01T00:00:00Z'))};
}
describe('explicit scans persist immutable certificate plans',()=>{
 it('writes case/events/certificate only after lock reads and retains formal blocking',async()=>{
  const s=setup(),result=await s.scan();expect(result).toMatchObject({changed:1,complete:false,settlementEligibility:'BLOCKED'});
  expect(state.locks).toEqual(expect.arrayContaining(['2026-03','2026-04']));
  const head=s.docs.get('attendanceCaseScans/'+evidenceHash([empId,month]));expect(s.docs.has('attendanceScanCertificates/'+head.certificateId)).toBe(true);
  const first=s.log.findIndex(x=>x.startsWith('write:'));expect(s.log.slice(first).every(x=>x.startsWith('write:'))).toBe(true);
  const before=s.log.length;expect((await s.scan()).changed).toBe(0);expect(s.log.slice(before).every(x=>x.startsWith('read:'))).toBe(true);
 });
 it('does not recreate a retained case deleted between scans',async()=>{
  const s=setup();await s.scan();s.docs.delete('attendanceCases/'+s.o.id);const before=s.log.length;
  await expect(s.scan()).rejects.toThrow();expect(s.log.slice(before).every(x=>x.startsWith('read:'))).toBe(true);expect(s.docs.has('attendanceCases/'+s.o.id)).toBe(false);
 });
 it('does not overwrite a head whose immutable certificate has disappeared',async()=>{
  const s=setup();await s.scan();const path='attendanceCaseScans/'+evidenceHash([empId,month]),head=s.docs.get(path);s.docs.delete('attendanceScanCertificates/'+head.certificateId);const before=s.log.length;
  await expect(s.scan()).rejects.toThrow();expect(s.docs.get(path)).toEqual(head);expect(s.log.slice(before).every(x=>x.startsWith('read:'))).toBe(true);
 });
});
