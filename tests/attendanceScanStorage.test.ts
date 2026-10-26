import {describe,it,expect} from 'vitest';
import {prepareAttendanceScanCertificate,loadAttendanceScanCertificate} from '../netlify/functions/utils/attendanceScanStorage';
import {caseKey,evidenceHash,reconcileCase} from '../netlify/functions/utils/attendanceCaseLifecycle';
import type {CaseObservation} from '../netlify/functions/utils/attendanceCaseTypes';

const empId='SYNTH-storage',month='2026-04',at='2026-05-02T00:00:00Z';
const observation=(outcome:CaseObservation['outcome']='finding'):CaseObservation=>({schemaVersion:'attendance-case-v1',detectorVersion:'detector-v1',id:caseKey(empId,'missing-in','card:synthetic'),empId,type:'missing-in',anchor:'card:synthetic',window:{start:29583360,end:29583420},outcome,reason:'synthetic',refs:[],evidenceVersion:evidenceHash(['synthetic',outcome]),policyVersion:null,payrollDecision:'none'});
const existing=()=>reconcileCase(undefined,observation(),'SYNTH-manager',at)!;
const args=(extra:Record<string,unknown>={})=>({empId,month,observations:[observation()],cases:[existing()],actor:'SYNTH-manager',at,...extra});
const pointerPath='attendanceCaseScans/'+evidenceHash([empId,month]);
function store(){
 const docs=new Map<string,any>(),log:string[]=[];
 const db={collection:(name:string)=>({doc:(id:string)=>({path:name+'/'+id})})};
 const tx={get:async(ref:any)=>{log.push('read:'+ref.path);return {exists:docs.has(ref.path),id:ref.path.split('/').at(-1),data:()=>structuredClone(docs.get(ref.path))};},
  create:(ref:any,data:any)=>{log.push('create:'+ref.path);if(docs.has(ref.path))throw new Error('Already exists');docs.set(ref.path,structuredClone(data));},
  set:(ref:any,data:any)=>{log.push('set:'+ref.path);docs.set(ref.path,structuredClone(data));}};
 return {db,tx,docs,log};
}
const certificatePath=(id:string)=>'attendanceScanCertificates/'+id;

describe('server scan certificate storage planning',()=>{
 it('loads only verified immutable certificates and never upgrades during reads',async()=>{
  const s=store();expect((await loadAttendanceScanCertificate(s.db,s.tx,{empId,month})).status).toBe('missing');
  const p=await prepareAttendanceScanCertificate(s.db,s.tx,args());p.commit();const before=s.log.length;
  expect(await loadAttendanceScanCertificate(s.db,s.tx,{empId,month})).toMatchObject({status:'loaded',certificateId:p.certificateId});
  s.docs.delete(certificatePath(p.certificateId));expect((await loadAttendanceScanCertificate(s.db,s.tx,{empId,month})).status).toBe('unknown');
  expect(s.log.slice(before).every(x=>x.startsWith('read:'))).toBe(true);
 });
 it('performs only reads until deferred commit and exposes the caller month-lock contract',async()=>{
  const s=store(),p=await prepareAttendanceScanCertificate(s.db,s.tx,args());
  expect(s.log.every(x=>x.startsWith('read:'))).toBe(true);expect(s.docs.size).toBe(0);
  expect(p.requiredMonths).toEqual([month]);expect(p.retainedCaseIds).toEqual([existing().id]);
  // The integration owner must read/assert all affected month locks before commit.
  await s.tx.get({path:'monthLocks/'+month});p.commit();
  expect(s.docs.has(certificatePath(p.certificateId))).toBe(true);expect(s.docs.get(pointerPath).certificateId).toBe(p.certificateId);
  const firstWrite=s.log.findIndex(x=>!x.startsWith('read:'));expect(s.log.slice(firstWrite).every(x=>!x.startsWith('read:'))).toBe(true);
 });
 it('reuses identical stable evidence despite a later actor/time without overwriting immutable evidence',async()=>{
  const s=store(),first=await prepareAttendanceScanCertificate(s.db,s.tx,args());first.commit();
  const snapshot=JSON.stringify([...s.docs]),before=s.log.length;
  const retry=await prepareAttendanceScanCertificate(s.db,s.tx,args({at:'2026-05-03T00:00:00Z',actor:'SYNTH-other-manager'}));
  expect(retry.certificateId).toBe(first.certificateId);expect(retry.reused).toBe(true);retry.commit();
  expect(JSON.stringify([...s.docs])).toBe(snapshot);expect(s.log.slice(before).every(x=>x.startsWith('read:'))).toBe(true);
 });
 it('requires explicit rescan upgrade of a legacy summary',async()=>{
  const s=store();s.docs.set(pointerPath,{empId,yearMonth:month,sourceVersion:'legacy',complete:false,actor:'SYNTH-manager',at});
  await expect(prepareAttendanceScanCertificate(s.db,s.tx,args())).rejects.toThrow();
  const p=await prepareAttendanceScanCertificate(s.db,s.tx,args({allowLegacyUpgrade:true}));expect(s.docs.get(pointerPath).certificateId).toBeUndefined();p.commit();
  expect(s.docs.get(pointerPath).certificateId).toBe(p.certificateId);
 });
 it.each(['missing-certificate','wrong-employee','wrong-month','bad-pointer','bad-certificate','duplicate-heads'] as const)('fails closed for prior evidence: %s',async mode=>{
  const s=store(),p=await prepareAttendanceScanCertificate(s.db,s.tx,args());p.commit();
  const pointer=s.docs.get(pointerPath),cert=s.docs.get(certificatePath(p.certificateId));
  if(mode==='missing-certificate')s.docs.delete(certificatePath(p.certificateId));
  if(mode==='wrong-employee')pointer.empId='OTHER';if(mode==='wrong-month')pointer.month='2026-05';
  if(mode==='bad-pointer')pointer.certificateId='';if(mode==='bad-certificate')cert.actor='';
  if(mode==='duplicate-heads')cert.caseHeads.push(cert.caseHeads[0]);
  const before=s.log.length;await expect(prepareAttendanceScanCertificate(s.db,s.tx,args({allowLegacyUpgrade:true}))).rejects.toThrow();
  expect(s.log.slice(before).every(x=>x.startsWith('read:'))).toBe(true);
 });
 it('refuses to recreate a deleted retained case through projected cases',async()=>{
  const s=store(),p=await prepareAttendanceScanCertificate(s.db,s.tx,args());p.commit();
  await expect(prepareAttendanceScanCertificate(s.db,s.tx,args({cases:[],projectedCases:[existing()]}))).rejects.toThrow();
  expect(s.docs.get(pointerPath).certificateId).toBe(p.certificateId);
 });
 it('retains earlier case IDs even when new observations no longer mention them',async()=>{
  const s=store(),p=await prepareAttendanceScanCertificate(s.db,s.tx,args());p.commit();
  const next=await prepareAttendanceScanCertificate(s.db,s.tx,args({observations:[]}));
  expect(next.retainedCaseIds).toContain(existing().id);expect(next.certificate.caseHeads.map((h:any)=>h.id)).toContain(existing().id);
 });
 it.each(['source','case'] as const)('creates a new certificate for changed %s evidence and retains the old immutable row',async mode=>{
  const s=store(),p=await prepareAttendanceScanCertificate(s.db,s.tx,args());p.commit();
  const changed=mode==='source'?{observations:[observation('clear')]}:{projectedCases:[{...existing(),revision:2}]};
  const next=await prepareAttendanceScanCertificate(s.db,s.tx,args(changed));expect(next.certificateId).not.toBe(p.certificateId);next.commit();
  expect(s.docs.has(certificatePath(p.certificateId))).toBe(true);expect(s.docs.get(pointerPath).certificateId).toBe(next.certificateId);
 });
 it('rejects mismatched observation scope and malformed case identity',async()=>{
  const s=store();await expect(prepareAttendanceScanCertificate(s.db,s.tx,args({observations:[{...observation(),empId:'OTHER'}]}))).rejects.toThrow();
  await expect(prepareAttendanceScanCertificate(s.db,s.tx,args({cases:[{...existing(),empId:null}]}))).rejects.toThrow();expect(s.docs.size).toBe(0);
 });
 it('rejects excess capacity without partial certificate writes',async()=>{
  const s=store(),cases=Array.from({length:501},(_,n)=>({...existing(),id:'synthetic-'+n}));
  await expect(prepareAttendanceScanCertificate(s.db,s.tx,args({cases}))).rejects.toThrow();expect(s.docs.size).toBe(0);
 });
});
