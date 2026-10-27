import {describe,it,expect,vi} from 'vitest';
import {UserRole} from '../types';
import {caseKey,evidenceHash,reconcileCase} from '../netlify/functions/utils/attendanceCaseLifecycle';
import {assessAttendanceExplanationInventory} from '../netlify/functions/utils/attendanceExplanationInventory';
const state=vi.hoisted(()=>({tx:null as any,fresh:true}));
vi.mock('../netlify/functions/utils/monthGuard',()=>({runPayrollMutation:async(_db:any,_months:any,fn:any)=>fn(state.tx),assertTransactionMonths:async(_db:any,tx:any,months:string[])=>{for(const m of months)await tx.get({path:'monthLocks/'+m});},monthsInRange:()=>['2026-04']}));
vi.mock('../netlify/functions/utils/workflowCapacity',()=>({assertWorkflowCapacity:async()=>{}}));
vi.mock('../netlify/functions/utils/attendanceCaseService',async original=>({...await original<any>(),assertCurrentCaseSource:async()=>{if(!state.fresh)throw new Error('source not freshly scanned');}}));
import {handleExplanationAction} from '../netlify/functions/utils/anomalyExplanations';
const empId='SYNTH',at='2026-04-02T00:00:00Z';
function setup(stale=true,closed=false){
 const o:any={schemaVersion:'attendance-case-v1',detectorVersion:'detector-v1',id:caseKey(empId,'missing-in','card:synthetic'),empId,type:'missing-in',anchor:'card:synthetic',window:{start:Date.parse('2026-04-01T01:00:00Z')/60000,end:Date.parse('2026-04-01T09:00:00Z')/60000},outcome:'finding',reason:'synthetic source',refs:[],evidenceVersion:'old',policyVersion:null,payrollDecision:'none'};
 const original=reconcileCase(undefined,o,empId,at)!,c=stale?reconcileCase(original,{...o,evidenceVersion:'changed',outcome:closed?'clear':'finding'},'SYNTH-manager',at)!:original;
 const history=[{id:evidenceHash(['ex',1]),revision:1,actor:empId,at,from:null,to:'submitted',reason:'synthetic narrative'},
  {id:evidenceHash(['ex',2]),revision:2,actor:'SYNTH-manager',at,from:'submitted',to:'accepted',reason:'synthetic review'}];
 const snapshot={caseId:c.id,empId,evidenceVersion:'old',startDate:'2026-04-01T01:00:00Z',endDate:'2026-04-01T09:00:00Z',refsHash:evidenceHash([]),explanationRevision:2,acceptedBy:'SYNTH-manager',acceptedAt:at};
 const ex={id:'ex',schemaVersion:'anomaly-explanation-v1',empId,caseId:c.id,revision:2,status:'accepted',history,sourceRefs:[],caseEvidenceVersion:'old',startDate:snapshot.startDate,endDate:snapshot.endDate,acceptedSource:{...snapshot,hash:evidenceHash(snapshot)}};
 const linkId=evidenceHash([c.id,'ex']);const docs=new Map<string,any>([['employees/'+empId,{role:UserRole.Employee}],['employees/SYNTH-manager',{role:UserRole.Admin}],['attendanceCases/'+c.id,c],['anomalyExplanations/ex',ex],['caseExplanationLinks/'+linkId,{id:linkId,caseId:c.id,sourceId:'ex'}],...history.map(e=>['anomalyExplanationEvents/'+e.id,{...e,explanationId:'ex',caseId:c.id,empId}] as [string,any])]);
 const log:string[]=[];
 const readable=(ref:any)=>({...ref,get:()=>state.tx.get(ref)});
 const db={collection:(name:string)=>({doc:(id:string)=>readable({path:name+'/'+id}),where:(key:string,_op:string,value:string)=>({limit:()=>readable({name,key,value})})})};
 state.fresh=true;state.tx={get:async(ref:any)=>{log.push('read');if(ref.path)return {exists:docs.has(ref.path),id:ref.path.split('/').at(-1),data:()=>structuredClone(docs.get(ref.path))};const rows=[...docs].filter(([p,d])=>p.startsWith(ref.name+'/')&&d[ref.key]===ref.value).map(([p,d])=>({id:p.split('/').at(-1),data:()=>structuredClone(d)}));return {size:rows.length,docs:rows};},set:(ref:any,d:any)=>{log.push('write');docs.set(ref.path,structuredClone(d));},create:(ref:any,d:any)=>{log.push('write');if(docs.has(ref.path))throw new Error('exists');docs.set(ref.path,structuredClone(d));}};
 const request={caseId:c.id,explanationId:'ex',expectedRevision:2,expectedCaseRevision:c.revision,expectedEvidenceVersion:c.observation.evidenceVersion,operationId:'synthetic-resubmit',mode:'resubmit',reason:'source changed explicit resubmission',text:'fresh narrative awaiting independent review'};
 return {db,docs,log,c,ex,request,run:()=>handleExplanationAction(db,empId,'act-anomaly-explanation',request)};
}
describe('employee recovery from stale accepted narrative',()=>{
 it('GET exposes authoritative recovery IDs only with intact fresh evidence and remains read-only',async()=>{
  const s=setup(true,true),get=()=>handleExplanationAction(s.db,empId,'get-case-explanation-workflow',{caseId:s.c.id});
  expect(await get()).toMatchObject({caseStatus:'resolved',sourceFreshness:'verified',explanationInventoryStatus:'complete',resubmittableAcceptedIds:['ex'],reviewableReplacementIds:[]});
  expect(s.log).not.toContain('write');state.fresh=false;expect(await get()).toMatchObject({sourceFreshness:'unknown',resubmittableAcceptedIds:[]});
  state.fresh=true;s.docs.get('anomalyExplanations/ex').acceptedSource.hash='corrupt';expect(await get()).toMatchObject({explanationInventoryStatus:'unknown',sourceFreshness:'unknown',resubmittableAcceptedIds:[]});
 });
 it('preserves historical proof and creates an independently reviewed replacement after fresh source scan',async()=>{
  const s=setup(),proof=structuredClone(s.ex.acceptedSource),next=await s.run(),old=s.docs.get('anomalyExplanations/ex');
  expect(old.status).toBe('superseded');expect(old.acceptedSource).toEqual(proof);expect(old.history).toHaveLength(3);expect(next.status).toBe('submitted');expect(next.supersedesId).toBe('ex');expect(old.supersededBy).toBe(next.id);expect(next.acceptedSource).toBeUndefined();
  const rows=(prefix:string)=>[...s.docs].filter(([p])=>p.startsWith(prefix+'/')).map(([,v])=>v);
  const inventory=assessAttendanceExplanationInventory({empId,cases:rows('attendanceCases'),explanations:rows('anomalyExplanations'),events:rows('anomalyExplanationEvents'),links:rows('caseExplanationLinks')});
  expect(inventory.status).toBe('complete');expect(inventory.staleAcceptedIds).toEqual([]);expect(inventory.pendingIds).toEqual([next.id]);expect(s.docs.get('attendanceCases/'+s.c.id).status).toBe('awaiting-review');
  const first=s.log.indexOf('write');expect(s.log.slice(first).every(x=>x==='write')).toBe(true);
 });
 it('refuses replacement of still-current accepted evidence and direct cancellation',async()=>{
  const s=setup(false);await expect(s.run()).rejects.toThrow();s.request.mode='cancel';await expect(s.run()).rejects.toThrow();expect(s.log).not.toContain('write');
 });
 it('can retire stale acceptance after a clear rescan without reopening the terminal case',async()=>{
  const s=setup(true,true),replacement=await s.run();expect(s.docs.get('anomalyExplanations/ex').status).toBe('superseded');expect(s.docs.get('attendanceCases/'+s.c.id).status).toBe('resolved');
  const current=s.docs.get('attendanceCases/'+s.c.id);
  const workflow=await handleExplanationAction(s.db,'SYNTH-manager','get-case-explanation-workflow',{caseId:s.c.id});expect(workflow.reviewableReplacementIds).toEqual([replacement.id]);
  const reviewed=await handleExplanationAction(s.db,'SYNTH-manager','act-anomaly-explanation',{...s.request,explanationId:replacement.id,expectedRevision:1,expectedCaseRevision:current.revision,operationId:'independent-terminal-review',mode:'accept',reason:'independent new source review'});
  expect(reviewed.status).toBe('accepted');expect(reviewed.acceptedSource.evidenceVersion).toBe('changed');expect(s.docs.get('attendanceCases/'+s.c.id).status).toBe('resolved');
 });
 it('refuses unscanned source or corrupted historical proof',async()=>{
  const s=setup();state.fresh=false;await expect(s.run()).rejects.toThrow();state.fresh=true;s.docs.get('anomalyExplanations/ex').acceptedSource.hash='corrupted';await expect(s.run()).rejects.toThrow();expect(s.log).not.toContain('write');
 });
 it('does not authorize ordinary unlinked narratives for terminal-case review',async()=>{
  const s=setup(true,true),old=s.docs.get('anomalyExplanations/ex');old.status='submitted';old.revision=1;old.history=old.history.slice(0,1);delete old.acceptedSource;
  s.docs.delete('anomalyExplanationEvents/'+evidenceHash(['ex',2]));
  await expect(handleExplanationAction(s.db,'SYNTH-manager','act-anomaly-explanation',{...s.request,expectedRevision:1,mode:'accept',operationId:'unlinked-terminal-review'})).rejects.toThrow();expect(s.log).not.toContain('write');
 });
 it('permits explicit terminal replacement resubmission after independent request-info',async()=>{
  const s=setup(true,true),replacement=await s.run();let c=s.docs.get('attendanceCases/'+s.c.id);
  const review=await handleExplanationAction(s.db,'SYNTH-manager','act-anomaly-explanation',{...s.request,explanationId:replacement.id,expectedRevision:1,expectedCaseRevision:c.revision,operationId:'terminal-needs-info',mode:'request-info',reason:'independent request for more evidence'});
  const workflow=await handleExplanationAction(s.db,empId,'get-case-explanation-workflow',{caseId:s.c.id});expect(workflow.resubmittableReplacementIds).toEqual([replacement.id]);
  c=s.docs.get('attendanceCases/'+s.c.id);
  const next=await handleExplanationAction(s.db,empId,'act-anomaly-explanation',{...s.request,explanationId:replacement.id,expectedRevision:review.revision,expectedCaseRevision:c.revision,operationId:'terminal-further-response',mode:'resubmit'});
  expect(next.status).toBe('submitted');expect(next.supersedesId).toBe(replacement.id);expect(s.docs.get('attendanceCases/'+s.c.id).status).toBe('resolved');
 });
});
