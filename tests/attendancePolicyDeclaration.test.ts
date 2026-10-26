import {describe,it,expect,vi} from 'vitest';
import {UserRole} from '../types';
import {employee,month,schedule} from './fixtures/payrollV2';
import {scheduleDayVersion} from '../netlify/functions/utils/attendanceCaseDetector';
const state=vi.hoisted(()=>({tx:null as any,locked:false}));
vi.mock('../netlify/functions/utils/monthGuard',()=>({runPayrollMutation:async(_db:any,_m:any,f:any)=>f(state.tx),assertTransactionMonths:async(_db:any,tx:any,months:string[])=>{for(const m of months)await tx.get({path:'monthLocks/'+m});if(state.locked)throw new Error('locked');}}));
import {handleAttendancePolicyDeclarationAction as action,loadAttendancePolicyDeclarationEvidence,attendancePolicyDeclarationId} from '../netlify/functions/utils/attendancePolicyDeclaration';
const empId=employee.id,A='SYNTH-proposer',B='SYNTH-reviewer';
function setup(){
 const docs=new Map<string,any>([['employees/'+empId,{role:UserRole.Employee}],['employees/'+A,{role:UserRole.SuperAdmin}],['employees/'+B,{role:UserRole.SuperAdmin}],['dailySchedule/2026-04-01',schedule()]]),log:string[]=[];
 const get=async(ref:any)=>{log.push('read:'+(ref.path||ref.collection));if(ref.path)return {exists:docs.has(ref.path),id:ref.path.split('/').at(-1),data:()=>structuredClone(docs.get(ref.path))};const rows=[...docs].filter(([p])=>p.startsWith(ref.collection+'/')).map(([p,d])=>({id:p.split('/').at(-1),data:()=>structuredClone(d)}));return {size:rows.length,docs:rows};};
 const db={collection:(collection:string)=>({doc:(id:string)=>{const ref:any={path:collection+'/'+id};ref.get=()=>get(ref);return ref;},limit:()=>{const ref:any={collection};ref.get=()=>get(ref);return ref;}})};
 state.locked=false;state.tx={get,set:(ref:any,d:any)=>{log.push('write:'+ref.path);docs.set(ref.path,structuredClone(d));},create:(ref:any,d:any)=>{if(docs.has(ref.path))throw new Error('exists');log.push('write:'+ref.path);docs.set(ref.path,structuredClone(d));}};
 const proposal={empId,month,expectedRevision:0,operationId:'synthetic-proposal',reason:'synthetic declaration evidence',closeAfterMinutes:0,lateGraceMinutes:0,earlyGraceMinutes:0,workDifferenceTolerance:0,expectedWorkByDate:{'2026-04-01':{minutes:480,scheduleVersion:scheduleDayVersion(schedule(),empId)}}};
 const review={empId,month,expectedRevision:1,operationId:'synthetic-review',mode:'approve',reason:'synthetic approval evidence'};
 return {db,docs,log,proposal,review};
}
describe('operational attendance policy declaration',()=>{
 it('requires two people, retains immutable revisions and gives trusted approved evidence',async()=>{
  const s=setup();await action(s.db,A,'propose-attendance-policy-declaration',s.proposal);
  await expect(action(s.db,A,'review-attendance-policy-declaration',s.review)).rejects.toThrow();
  await action(s.db,B,'review-attendance-policy-declaration',s.review);
  const e=await loadAttendancePolicyDeclarationEvidence(s.db,state.tx,empId,month);expect(e.assessment.status).toBe('verified');expect(e.assessment.policy?.breaks).toBe('explicit');expect(e.current.revision).toBe(2);
  expect(s.docs.has('attendancePolicyDeclarationVersions/'+attendancePolicyDeclarationId(empId,month)+'_1')).toBe(true);
 });
 it('replays identical command without writes and rejects changed command',async()=>{
  const s=setup();const first=await action(s.db,A,'propose-attendance-policy-declaration',s.proposal),before=s.log.length;
  expect(await action(s.db,A,'propose-attendance-policy-declaration',s.proposal)).toEqual(first);expect(s.log.slice(before).every(l=>l.startsWith('read:'))).toBe(true);
  await expect(action(s.db,A,'propose-attendance-policy-declaration',{...s.proposal,lateGraceMinutes:1})).rejects.toThrow();
 });
 it.each(['missing-version','altered-result','wrong-actor'] as const)('verifies immutable evidence before receipt replay: %s',async mode=>{
  const s=setup();await action(s.db,A,'propose-attendance-policy-declaration',s.proposal);
  const receipt=[...s.docs].find(([path])=>path.startsWith('attendancePolicyDeclarationCommands/'))![1];
  if(mode==='missing-version')s.docs.delete('attendancePolicyDeclarationVersions/'+attendancePolicyDeclarationId(empId,month)+'_1');
  if(mode==='altered-result')receipt.result.values.lateGraceMinutes=99;if(mode==='wrong-actor')receipt.actor=B;
  const before=s.log.length;await expect(action(s.db,A,'propose-attendance-policy-declaration',s.proposal)).rejects.toThrow();expect(s.log.slice(before).every(l=>l.startsWith('read:'))).toBe(true);
 });
 it('permits replay of an authentic earlier proposal retained in the current immutable prefix',async()=>{
  const s=setup(),first=await action(s.db,A,'propose-attendance-policy-declaration',s.proposal);await action(s.db,B,'review-attendance-policy-declaration',s.review);
  expect(await action(s.db,A,'propose-attendance-policy-declaration',s.proposal)).toEqual(first);
 });
 it('rejects self, missing numeric inputs and server-proof injection',async()=>{
  const s=setup();await expect(action(s.db,empId,'propose-attendance-policy-declaration',s.proposal)).rejects.toThrow();
  await expect(action(s.db,A,'propose-attendance-policy-declaration',{...s.proposal,lateGraceMinutes:undefined})).rejects.toThrow();
  await expect(action(s.db,A,'propose-attendance-policy-declaration',{...s.proposal,approvedBy:B})).rejects.toThrow();
 });
 it('rechecks schedule binding and locks before approval with no partial writes',async()=>{
  const s=setup();await action(s.db,A,'propose-attendance-policy-declaration',s.proposal);
  s.docs.get('dailySchedule/2026-04-01').shifts[0].to='18:00';let before=s.log.length;
  await expect(action(s.db,B,'review-attendance-policy-declaration',s.review)).rejects.toThrow();expect(s.log.slice(before).every(l=>l.startsWith('read:'))).toBe(true);
  state.locked=true;before=s.log.length;await expect(action(s.db,B,'review-attendance-policy-declaration',s.review)).rejects.toThrow();expect(s.log.slice(before).every(l=>l.startsWith('read:'))).toBe(true);
 });
 it('does not trust missing immutable history or fall back from a pending replacement',async()=>{
  const s=setup();await action(s.db,A,'propose-attendance-policy-declaration',s.proposal);await action(s.db,B,'review-attendance-policy-declaration',s.review);
  await action(s.db,A,'propose-attendance-policy-declaration',{...s.proposal,expectedRevision:2,operationId:'replacement'});
  expect((await loadAttendancePolicyDeclarationEvidence(s.db,state.tx,empId,month)).assessment.status).toBe('unknown');
  s.docs.delete('attendancePolicyDeclarationVersions/'+attendancePolicyDeclarationId(empId,month)+'_1');await expect(loadAttendancePolicyDeclarationEvidence(s.db,state.tx,empId,month)).rejects.toThrow();
 });
 it('blocks every historical proposer from reviewing and rechecks roles before receipt replay',async()=>{
  const s=setup();await action(s.db,A,'propose-attendance-policy-declaration',s.proposal);await action(s.db,B,'review-attendance-policy-declaration',s.review);
  await action(s.db,B,'propose-attendance-policy-declaration',{...s.proposal,expectedRevision:2,operationId:'other-replacement'});
  await expect(action(s.db,A,'review-attendance-policy-declaration',{...s.review,expectedRevision:3,operationId:'historical-author-review'})).rejects.toThrow();
  s.docs.get('employees/'+A).role=UserRole.Employee;await expect(action(s.db,A,'propose-attendance-policy-declaration',s.proposal)).rejects.toThrow();
 });
 it('never reads after a write inside one mutation and GET is read-only',async()=>{
  const s=setup();await action(s.db,A,'propose-attendance-policy-declaration',s.proposal);const first=s.log.findIndex(l=>l.startsWith('write:'));expect(s.log.slice(first).every(l=>l.startsWith('write:'))).toBe(true);
  const before=s.log.length,result=await action(s.db,B,'get-attendance-policy-declaration',{empId,month});expect(result.canManage).toBe(true);expect(result.scheduleTargets).toContainEqual({date:'2026-04-01',scheduleVersion:scheduleDayVersion(schedule(),empId)});expect(s.log.slice(before).every(l=>l.startsWith('read:'))).toBe(true);
 });
});
