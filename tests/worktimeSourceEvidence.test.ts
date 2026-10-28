import {beforeEach,describe,expect,it} from 'vitest';
import {loadWorktimeSourceEvidence} from '../netlify/functions/utils/worktimeSourceEvidence';
import {handleWorktimeDeclarationAction as action} from '../netlify/functions/utils/worktimeDeclarations';
import {clockSourceKey} from '../utils/attendance';
import {UserRole} from '../types';

// Only canonical monthly attendance/payroll inputs are supplied by a test seam.
// Declaration proposal, independent approval, immutable history and loading are real.
const empId='SYNTH',month='2026-08',docs=new Map<string,any>(),clone=(v:any)=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const doc=(path:string):any=>({path,id:path.split('/').pop(),async get(){return {exists:docs.has(path),id:path.split('/').pop(),data:()=>clone(docs.get(path))};}});
const db:any={collection:(name:string)=>({doc:(id:string)=>doc(name+'/'+id)}),async runTransaction(fn:any){const writes:any[]=[];let wrote=false;const tx:any={get:async(ref:any)=>{if(wrote)throw Error('read-after-write');return ref.get();}};for(const mode of ['create','set'])tx[mode]=(ref:any,value:any)=>{wrote=true;writes.push({mode,ref,value});};const result=await fn(tx);for(const w of writes)if(w.mode==='create'&&docs.has(w.ref.path))throw Error('exists');for(const w of writes)docs.set(w.ref.path,clone(w.value));return result;}};
const reader:any={get:(ref:any)=>ref.get()};let operation=0;
const declaration=()=>({regime:'standard-8-40',weekStartsOn:0,headcount:12,unionExists:false,overtimeMode:'46',cycle:null,rotation:'not-rotating',rotationRest:'unknown',exception:'none',sourceRefs:['DECLARATION-1'],authorities:['regime','collective-overtime','individual-overtime','rotation-applicability'].map(purpose=>({purpose,authorityOccurredAt:'2026-05-31T09:15:32.125+08:00',effectiveFrom:'2026-06-01',effectiveTo:'2026-10-31',sourceRefs:['AUTH-'+purpose],reason:'Synthetic original authority document',...(purpose==='collective-overtime'?{consentBody:'labor-management'}:{})})),workRules:{status:'recorded',basis:'below-30-recorded-terms',documentState:'effective',versionRef:'TERMS-1',authorityOccurredAt:'2026-05-31T10:00:00+08:00',effectiveFrom:'2026-06-01',effectiveTo:'2026-10-31',sourceRefs:['TERMS-1'],reason:'Synthetic effective employment terms'}});
const command=(extra:any={})=>({empId,month,expectedRevision:0,operationId:'source-op-'+(++operation),reason:'Synthetic independent source declaration',...extra});
async function approve(){const p=await action(db,'AUTHOR','propose-worktime-declaration',command({declaration:declaration()}));return action(db,'REVIEWER','review-worktime-declaration',command({expectedRevision:p.revision,mode:'approve'}));}
function source(m:string):any{
 const days:any[]=[];for(let t=Date.parse(m+'-01');new Date(t).toISOString().slice(0,7)===m;t+=86400000){const date=new Date(t).toISOString().slice(0,10),weekday=new Date(t).getUTCDay();days.push({date,employmentState:'active',dayType:weekday===0?'regular-holiday':weekday===6?'rest':'normal',policy:{status:'approved',workRegime:'standard-8-40'}});}
 return {kind:'live',sourceHash:'source-'+m,snapshotInputs:{employees:[{id:empId,effectiveMasterVersion:'MASTER-'+m,masterAssessment:{status:'confirmed'},normalPayDays:days}],records:[]},sourceEvidence:{attendanceMonthEvidence:{[empId]:{empId,month:m,inventory:'complete',scan:'current',findings:[],unknowns:[],missingCaseIds:[],missingDetectorInputs:[],observationDigest:'OBS-'+m}}},evaluation:{salaries:[{empId,normalPayPreview:{employeeId:empId,month:m,status:'ready',issues:[],overtimePreview:{lines:[],blocking:[],issues:[],complianceIssues:[]}}}]}};
}
function fixture(){return new Map(['2026-07','2026-08','2026-09'].map(m=>[m,source(m)]));}
function work(s:any,date:string,ranges:Array<[number,number]>,kind='normal-paid-separately'){
 const epoch=Date.parse(date+'T00:00:00+08:00'),first=ranges[0][0],last=ranges.at(-1)![1];
 const card:any={id:'CARD-'+date,empId,date,clockInTime:'00:00',clockOutTime:'00:00',clockInAt:new Date(epoch+first*60000).toISOString(),clockOutAt:new Date(epoch+last*60000).toISOString(),workIntervals:ranges.map(([start,end])=>({start,end}))};card.workReview={reviewedBy:'SUPERVISOR',reviewedAt:'2026-10-01T00:00:00Z',sourceKey:clockSourceKey(card)};s.snapshotInputs.records.push(card);
 s.evaluation.salaries[0].normalPayPreview.overtimePreview.lines.push(...ranges.map(([start,end])=>({date,start:epoch/60000+start,end:epoch/60000+end,kind,workdayId:'WORKDAY-'+date,sourceIds:[card.id],sourceVersions:[clockSourceKey(card)]})));
}
const load=(sources:Map<string,any>)=>loadWorktimeSourceEvidence(db,reader,{empId,month,at:'2026-10-26T00:00:00Z'},{loadMonth:async m=>clone(sources.get(m))});
beforeEach(()=>{docs.clear();operation=0;for(const id of ['AUTHOR','REVIEWER'])docs.set('employees/'+id,{role:UserRole.SuperAdmin});docs.set('employees/'+empId,{role:UserRole.Employee});});
describe('worktime adapter with real immutable declaration workflow',()=>{
 it('assesses standard nonrotating verified attendance without requiring tax/net readiness',async()=>{
  await approve();const sources=fixture();work(sources.get(month),'2026-08-03',[[540,720],[780,1020]]);const r=await load(sources);
  expect(r).toMatchObject({status:'within-checked-limits',issues:[],workRules:{status:'recorded-applicable'},declarationSource:{revision:2},formalEligibility:'BLOCKED',applicationStatus:'not-applied',paymentStatus:'not-paid'});
  expect(r.monthSources.map(s=>s.month)).toEqual(['2026-07','2026-08','2026-09']);expect(r.input?.days.find(d=>d.date==='2026-08-03')?.segments).toHaveLength(2);
 });
 it('retains original clock-in workday across midnight and counts physical tail only once',async()=>{
  await approve();const sources=fixture();work(sources.get('2026-09'),'2026-09-05',[[1380,1500]],'rest-day-additional');const r=await load(sources);
  expect(r.status).toBe('within-checked-limits');expect(r.input?.coverage.workdayTail?.through).toBe('2026-09-05T17:00:00.000Z');
  const d=r.input?.days.find(d=>d.date==='2026-09-05');expect(d?.segments).toHaveLength(1);expect(d?.segments[0].classification).toBe('rest-day');expect(d?.workdayEvidence?.kind).toBe('verified-clock-in-date');expect(r.input?.days.some(d=>d.date==='2026-09-06')).toBe(false);
 });
 it('holds a physical overnight tail when the next-day active master is absent',async()=>{
  await approve();const sources=fixture(),s=sources.get('2026-09');work(s,'2026-09-05',[[1380,1500]],'rest-day-additional');s.snapshotInputs.employees[0].normalPayDays=s.snapshotInputs.employees[0].normalPayDays.filter((d:any)=>d.date!=='2026-09-06');
  expect(await load(sources)).toMatchObject({status:'needs-review',issues:['physical-workday-tail-employment-source-missing'],input:null});
 });
 it('does not reuse prior approval when the current head is a pending replacement',async()=>{
  const a=await approve();await action(db,'AUTHOR','propose-worktime-declaration',command({expectedRevision:a.revision,declaration:declaration()}));
  expect(await load(fixture())).toMatchObject({status:'needs-review',issues:['worktime-declaration-not-independently-approved'],input:null});
 });
 it('rejects a mutated approved head instead of trusting its status alone',async()=>{
  const a=await approve();docs.get('worktimeDeclarations/'+a.id).declaration.headcount=29;expect(await load(fixture())).toMatchObject({status:'needs-review',input:null});
 });
 it('does not turn absent or partial employment into zero attendance',async()=>{
  await approve();for(const state of ['not-employed','unknown']){const sources=fixture();sources.get(month).snapshotInputs.employees[0].normalPayDays.find((d:any)=>d.date==='2026-08-03').employmentState=state;const r=await load(sources);expect(r.status).toBe('needs-review');expect(r.issues).toContain('partial-employment-or-day-classification-unsupported:2026-08-03');expect(r.input).toBeNull();}
 });
 it('counts holiday actual work and breaks, splitting after 480 verified minutes',async()=>{
  await approve();const sources=fixture(),s=sources.get(month);s.snapshotInputs.employees[0].normalPayDays.find((d:any)=>d.date==='2026-08-04').dayType='national-holiday';work(s,'2026-08-04',[[540,720],[780,1140]],'holiday-work');const r=await load(sources),segments=r.input?.days.find(d=>d.date==='2026-08-04')?.segments||[];
  expect(r.status).toBe('within-checked-limits');expect(segments.map(s=>[s.classification,(Date.parse(s.end)-Date.parse(s.start))/60000])).toEqual([['holiday-normal',180],['holiday-normal',300],['holiday-overtime',60]]);expect(r.compliance.checks.find(c=>c.id==='monthly-overtime')?.actualMinutes).toBe(60);
 });
 it('retains unresolved holiday consent even when all actual holiday minutes are classified',async()=>{
  await approve();const sources=fixture(),s=sources.get(month);s.snapshotInputs.employees[0].normalPayDays.find((d:any)=>d.date==='2026-08-04').dayType='national-holiday';work(s,'2026-08-04',[[540,720],[780,1140]],'holiday-work');
  s.evaluation.salaries[0].normalPayPreview.overtimePreview.complianceIssues=['synthetic-holiday-consent-unverified'];
  const r=await load(sources),segments=r.input?.days.find(d=>d.date==='2026-08-04')?.segments||[];
  expect(segments.reduce((n,s)=>n+(Date.parse(s.end)-Date.parse(s.start))/60000,0)).toBe(540);
  expect(r.compliance.checks.find(c=>c.id==='monthly-overtime')?.actualMinutes).toBe(60);
  expect(r.status).toBe('needs-review');expect(r.issues).toContain('existing-overtime-compliance:synthetic-holiday-consent-unverified');
  expect(r.compliance.checks.every(c=>c.status==='needs-review'&&c.issues.includes('existing-overtime-compliance:synthetic-holiday-consent-unverified'))).toBe(true);expect(r.formalEligibility).toBe('BLOCKED');
 });
 it('retains personal-leave legal minutes finding rather than replacing it with actual-work-only readiness',async()=>{
  await approve();const sources=fixture(),s=sources.get(month);work(s,'2026-08-03',[[540,1020],[1020,1080]]);
  const ot=s.evaluation.salaries[0].normalPayPreview.overtimePreview;ot.lines[1].kind='weekday-overtime';
  ot.actualWorkMinutes=540;ot.personalLeaveComplianceMinutes=240;ot.statutoryComplianceMinutes=780;ot.complianceIssues=['synthetic-personal-leave-plus-work-780-exceeds-limit'];
  const r=await load(sources),segments=r.input?.days.find(d=>d.date==='2026-08-03')?.segments||[];
  expect(segments.reduce((n,s)=>n+(Date.parse(s.end)-Date.parse(s.start))/60000,0)).toBe(540);
  expect(r.compliance.checks.find(c=>c.id==='monthly-overtime')?.actualMinutes).toBe(60);
  expect(r.status).toBe('needs-review');expect(r.issues).toContain('existing-overtime-compliance:synthetic-personal-leave-plus-work-780-exceeds-limit');
  expect(r.compliance.checks.every(c=>c.status==='needs-review')).toBe(true);expect(r.formalEligibility).toBe('BLOCKED');
 });
 it('holds incomplete attendance scans and classified intervals missing actual work',async()=>{
  await approve();const stale=fixture();stale.get(month).sourceEvidence.attendanceMonthEvidence[empId].scan='stale';expect((await load(stale)).issues).toContain('attendance-history-not-complete-and-current:2026-08');
  const missing=fixture();work(missing.get(month),'2026-08-03',[[540,720]]);missing.get(month).evaluation.salaries[0].normalPayPreview.overtimePreview.lines=[];expect((await load(missing)).issues).toContain('classified-history-does-not-cover-actual:2026-08-03');
 });
});
