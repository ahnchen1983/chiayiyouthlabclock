vi.mock('../netlify/functions/utils/makeupAttachmentRuntime', async importOriginal => ({...await importOriginal<typeof import('../netlify/functions/utils/makeupAttachmentRuntime')>(),getMakeupAttachmentRuntime:vi.fn(),getLeaveAttachmentRuntime:vi.fn()}));
import {getMakeupAttachmentRuntime,getLeaveAttachmentRuntime} from '../netlify/functions/utils/makeupAttachmentRuntime';
import {syntheticAttachmentRuntime,syntheticPdf} from './fixtures/makeupAttachments';
let attachmentFixture:ReturnType<typeof syntheticAttachmentRuntime>;
beforeEach(()=>{attachmentFixture=syntheticAttachmentRuntime(false);vi.mocked(getMakeupAttachmentRuntime).mockReturnValue(attachmentFixture.runtime);vi.mocked(getLeaveAttachmentRuntime).mockReturnValue(attachmentFixture.runtime);});
import { hasAppliedMakeup } from '../netlify/functions/utils/makeupEvidence';
// Snapshot transaction contract tests isolate formal eligibility below. Separate
// unmocked eligibility regressions assert that production lock-month always blocks.
vi.mock('../netlify/functions/utils/payrollPreflight', async importOriginal => {
    const actual = await importOriginal<typeof import('../netlify/functions/utils/payrollPreflight')>();
    return { ...actual, assertPayrollReady: vi.fn() };
});
import { assertPayrollReady } from '../netlify/functions/utils/payrollPreflight';
const trialTransactionGate = (r: any) => { if (r.trialStatus !== 'READY') { const e: any = new Error('BLOCKED trial inputs'); e.statusCode = 409; throw e; } };
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../netlify/functions/utils/calculations';
import { adminAuth } from '../netlify/functions/utils/firebaseAdmin';
import { clockSourceKey } from '../utils/attendance';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { card, employee, review, month, schedule, leave } from './fixtures/payrollV2';
import { UserRole, LeaveStatus, LeaveType } from '../types';

const fake = vi.hoisted(() => {
    const data = new Map<string, any>(); let sequence = 0;
    const clone = (x: any) => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
    const doc = (path: string): any => ({ path, id: path.split('/').pop(),
        async get() { return snapshot(path); },
        async set(value: any) { data.set(path, clone(value)); },
        async update(value: any) { if (!data.has(path)) throw Error('missing doc'); data.set(path, {...data.get(path),...clone(value)}); },
        async delete() { data.delete(path); },
    });
    const snapshot = (path: string): any => ({ ref: doc(path), id:path.split('/').pop(), exists:data.has(path), data:()=>clone(data.get(path)) });
    const collection = (path: string, filters: any[] = [], limit=Infinity): any => ({
        path, doc:(id?:string)=>doc(path+'/'+(id||`AUTO${++sequence}`)),
        where:(field:string,op:string,value:any)=>collection(path,[...filters,[field,op,value]],limit),
        limit:(value:number)=>collection(path,filters,value),
        orderBy:()=>collection(path,filters,limit),
        async add(value:any){ const ref=doc(path+`/AUTO${++sequence}`);await ref.set(value);return ref; },
        async get(){const docs=[...data.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===path.split('/').length+1).map(snapshot).filter(d=>filters.every(([f,op,v])=>op==='in'?v.includes(f==='__name__'?d.id:d.data()[f]):op==='=='?d.data()[f]===v:op==='>='?d.data()[f]>=v:op==='<='?d.data()[f]<=v:false)).slice(0,limit);return {docs,empty:!docs.length,size:docs.length};}
    });
    const db:any={collection,async runTransaction(fn:any){const writes:any[]=[];let wrote=false;const tx:any={get:async(ref:any)=>{if(wrote)throw Error('read after write');return ref.get();}};for(const method of ['set','update','delete','create'])tx[method]=(ref:any,value:any)=>{wrote=true;writes.push([method,ref,value]);};const result=await fn(tx);for(const [method,ref,value]of writes){if(method==='create'){if(data.has(ref.path))throw Error('exists');await ref.set(value);}else await ref[method](value);}return result;}};
    return {data,db};
});
vi.mock('../netlify/functions/utils/firebaseAdmin',()=>({db:fake.db,adminAuth:{verifyIdToken:vi.fn().mockResolvedValue({uid:'ADMIN'}),createCustomToken:vi.fn().mockResolvedValue('synthetic-token')},adminMessaging:()=>({sendEachForMulticast:vi.fn().mockResolvedValue({responses:[]})})}));
import {handler} from '../netlify/functions/api';
const call=async(action:string,body:any={})=>await handler({httpMethod:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify({action,...body})} as any,{} as any) as any;
const lock=(m=month)=>fake.data.set(`monthLocks/${m}`,{yearMonth:m,lockedAt:review.reviewedAt,lockedBy:'ADMIN',lockedByName:'synthetic',employeeCount:1,totalAmount:1600});
beforeEach(()=>{vi.mocked(assertPayrollReady).mockImplementation(trialTransactionGate);fake.data.clear();fake.data.set('employees/ADMIN',{id:'ADMIN',name:'reviewer',role:UserRole.SuperAdmin,hireDate:'2020-01-01',accountKind:'system-account',hourlyRate:0,monthlySalary:0});fake.data.set(`employees/${employee.id}`,{...employee,status:'在職',hireDate:'2026-01-01'});fake.data.set('clockRecords/C1',card());});
afterEach(()=>vi.useRealTimers());


import {terminationSeed,terminationManual} from './fixtures/terminationSettlement';
const asTerm=async(uid:string,action:string,data:any={})=>{vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid} as any);return call(action,{empId:'TERM',month:'2026-08',...data});};
const command=(extra:any={})=>({operationId:crypto.randomUUID(),reason:'合成離職逐項核對原因',expectedRevision:0,exitDate:'2026-08-15',manual:terminationManual(),...extra});
const save=async(extra:any={})=>asTerm('ADMIN','save-termination-draft',command(extra));
const submit=async(r:any)=>asTerm('ADMIN','submit-termination-draft',{draftId:r.id,expectedRevision:r.revision,operationId:crypto.randomUUID(),reason:'合成送第二人審核'});
const approve=async(r:any,extra:any={})=>asTerm('TERM_REVIEWER','review-termination-draft',{draftId:r.id,expectedRevision:r.revision,operationId:crypto.randomUUID(),reason:'合成第二人逐項覆核',mode:'approve',...extra});
beforeEach(()=>{for(const [key,value] of terminationSeed())fake.data.set(key,value);});
describe('C2m manual termination isolated API contract',()=>{
 it('persists exact manual/trial/delta, two-person approval, immutable revisions, never changes employee or payroll',async()=>{
 const before=fake.data.get('employees/TERM');const first=await save();expect(first.statusCode).toBe(200);const r=JSON.parse(first.body);expect(r.manual.issues).toEqual([]);expect(r.manual.items[0].delta).toEqual({numerator:'0',denominator:'1'});
 const pending=JSON.parse((await submit(r)).body);const approved=await approve(pending);expect(approved.statusCode).toBe(200);expect(JSON.parse(approved.body)).toMatchObject({status:'approved',formalEligibility:'BLOCKED',paymentStatus:'not-paid',applicationStatus:'not-applied'});
 expect([...fake.data.keys()].filter(k=>k.startsWith('terminationSettlementVersions/'))).toHaveLength(3);expect(fake.data.get('employees/TERM')).toEqual(before);expect([...fake.data.keys()].some(k=>k.startsWith('payrollRuns/'))).toBe(false);
 expect((await save({draftId:r.id,expectedRevision:3})).statusCode).toBe(409);
 });
 it('employee and ordinary manager cannot write or read another salary',async()=>{fake.data.set('employees/ORD',{role:UserRole.Admin});for(const who of ['TERM','ORD'])expect((await asTerm(who,'save-termination-draft',command())).statusCode).toBe(403);expect((await asTerm('ORD','get-termination-settlement')).statusCode).toBe(403);expect((await asTerm('TERM','get-termination-settlement')).statusCode).toBe(200);});
 it('creator/editor/submitter cannot approve and pending private amounts are hidden from employee',async()=>{const r=JSON.parse((await save()).body),p=JSON.parse((await submit(r)).body);expect((await asTerm('ADMIN','review-termination-draft',{...command(),draftId:p.id,expectedRevision:p.revision,mode:'approve'})).statusCode).toBe(403);expect(JSON.parse((await asTerm('TERM','get-termination-settlement')).body).records).toEqual([]);});
 it('same operation replays without versions/history growth; mismatched payload is rejected',async()=>{const c=command();const a=await asTerm('ADMIN','save-termination-draft',c),b=await asTerm('ADMIN','save-termination-draft',c);expect(b.body).toBe(a.body);expect([...fake.data.keys()].filter(k=>k.startsWith('terminationSettlementVersions/'))).toHaveLength(1);expect((await asTerm('ADMIN','save-termination-draft',{...c,reason:'不同重播內容拒絕'})).statusCode).toBe(409);});
 it('stale revision and stale source do not approve, rejection can reopen a draft with retained original evidence',async()=>{const r=JSON.parse((await save()).body),p=JSON.parse((await submit(r)).body);expect((await approve(p,{expectedRevision:1})).statusCode).toBe(409);fake.data.get('payrollPolicyVersions/TP').normalPay.version='changed';expect((await approve(p)).statusCode).toBe(409);const rejected=await approve(p,{mode:'reject'});expect(rejected.statusCode).toBe(200);const j=JSON.parse(rejected.body);expect((await save({draftId:j.id,expectedRevision:j.revision})).statusCode).toBe(200);expect(fake.data.get('terminationSettlementVersions/'+r.id+'_1').source.version).toBe(r.source.version);});
 it.each(['missing','extra-decimal','only-net','wrong-kind','duplicate-source'])('rejects %s manual input without partial writes',async mode=>{const manual=terminationManual();if(mode==='missing')manual.items[0].amount='';if(mode==='extra-decimal')manual.items[0].amount='15000.001';if(mode==='only-net')manual.items=manual.items.filter(i=>i.kind==='net');if(mode==='wrong-kind')manual.items[0].kind='deduction';if(mode==='duplicate-source')manual.items.push({...manual.items[0],code:'another'});expect((await save({manual})).statusCode).toBe(400);expect([...fake.data.keys()].some(k=>k.startsWith('terminationSettlement'))).toBe(false);});
 it.each(['manual-difference','net-mismatch','unknown-insurance','wrong-exit','missing-item'])('%s persists visible differences but cannot be approved by a checkbox',async mode=>{const manual=terminationManual();if(mode==='manual-difference'){manual.items[0].amount='14999.00';manual.items[4].amount='14999.00';}if(mode==='net-mismatch')manual.items[4].amount='14999.00';if(mode==='unknown-insurance')delete fake.data.get('payrollReviews/TERM_2026-08').review.insurance;if(mode==='missing-item')manual.items.splice(1,1);const saved=await save({manual,...(mode==='wrong-exit'?{exitDate:'2026-08-14'}:{})});expect(saved.statusCode).toBe(200);const r=JSON.parse(saved.body);expect(r.manual.issues.length).toBeGreaterThan(0);const p=JSON.parse((await submit(r)).body);expect((await approve(p,{confirmLegal:true,approvedBy:'forged'})).statusCode).toBe(409);});
 it('locked month, cross-month payload and changed month cannot mutate history or snapshot',async()=>{const r=JSON.parse((await save()).body);fake.data.set('monthLocks/2026-08',{lockedAt:'2026-09-01',lockedBy:'ADMIN'});expect((await submit(r)).statusCode).toBe(423);expect(fake.data.get('terminationSettlementDrafts/'+r.id).revision).toBe(1);fake.data.delete('monthLocks/2026-08');expect((await save({exitDate:'2026-09-01'})).statusCode).toBe(400);expect((await asTerm('ADMIN','submit-termination-draft',{...command(),month:'2026-09',draftId:r.id,expectedRevision:1})).statusCode).toBe(409);});
});

import {pendingRequestIssues} from '../netlify/functions/utils/payrollPreflight';
it('approved manual input still blocks formal adoption and does not affect another month',()=>{const sources:any={terminationSettlementDrafts:[{id:'T',empId:'TERM',month:'2026-08',status:'approved'}],terminationAdjustmentCases:[],compRequests:[],compSettlementTasks:[],overtimeRequests:[],anomalyExplanations:[],leaveRequests:[],makeupRequests:[],leaveOfAbsenceRequests:[],shiftSwapRequests:[]};expect(pendingRequestIssues('2026-08','TERM',sources,[],[]).length).toBeGreaterThan(0);expect(pendingRequestIssues('2026-09','TERM',sources,[],[])).toEqual([]);});
it('historical adjustment is idempotent, distinct from payroll snapshot and cannot claim paid',async()=>{const original={lockedAt:'2026-09-01',lockedBy:'ADMIN',payrollRunId:'OLD'};fake.data.set('monthLocks/2026-08',original);fake.data.set('payrollRuns/OLD',{untouched:'immutable'});const c=command();const a=await asTerm('ADMIN','open-termination-adjustment',c),b=await asTerm('ADMIN','open-termination-adjustment',c);expect(a.statusCode).toBe(200);expect(b.body).toBe(a.body);expect(JSON.parse(a.body)).toMatchObject({status:'pending-review',paymentStatus:'not-paid',originalPayrollRunId:'OLD'});expect(fake.data.get('monthLocks/2026-08')).toEqual(original);expect(fake.data.get('payrollRuns/OLD')).toEqual({untouched:'immutable'});});
it('technical retained record capacity fails before any new version or receipt',async()=>{for(let n=0;n<100;n++)fake.data.set('terminationSettlementDrafts/H'+n,{id:'H'+n,empId:'TERM',month:'2026-08',status:'rejected'});expect((await save()).statusCode).toBe(409);expect([...fake.data.keys()].some(k=>k.startsWith('terminationSettlementVersions/'))).toBe(false);});
it('pending correction or unresolved case cannot be approved as manual salary evidence',async()=>{fake.data.set('makeupRequests/P',{id:'P',empId:'TERM',date:'2026-08-02',status:'待審核'});const r=JSON.parse((await save()).body);expect(r.manual.issues.some((s:string)=>s.includes('補卡'))).toBe(true);const p=JSON.parse((await submit(r)).body);expect((await approve(p)).statusCode).toBe(409);});
it('an earlier editor cannot approve after a later editor resaves the draft',async()=>{fake.data.set('employees/EDITOR3',{id:'EDITOR3',role:UserRole.SuperAdmin});const r=JSON.parse((await save()).body);const second=await asTerm('TERM_REVIEWER','save-termination-draft',command({draftId:r.id,expectedRevision:1}));expect(second.statusCode).toBe(200);const third=await asTerm('EDITOR3','save-termination-draft',command({draftId:r.id,expectedRevision:2}));expect(third.statusCode).toBe(200);const p=JSON.parse((await asTerm('EDITOR3','submit-termination-draft',{...command(),draftId:r.id,expectedRevision:3})).body);expect((await approve(p)).statusCode).toBe(403);});
it('approved-looking leave with invalid dates stays unknown instead of disappearing from manual source checks',async()=>{fake.data.set('leaveRequests/INVALID',{empId:'TERM',status:'核准',startDate:'invalid',endDate:'invalid'});const saved=await save();expect(saved.statusCode).toBe(200);const r=JSON.parse(saved.body);expect(r.manual.issues.some((s:string)=>s.includes('假單期間來源無效'))).toBe(true);const p=JSON.parse((await submit(r)).body);expect((await approve(p)).statusCode).toBe(409);});
it('historical version API exposes immutable before values with employee/month scope, never live recomputation',async()=>{const r=JSON.parse((await save()).body);const manual=terminationManual();manual.items[0].amount='14999.00';manual.items[4].amount='14999.00';expect((await save({draftId:r.id,expectedRevision:1,manual})).statusCode).toBe(200);const first=await asTerm('ADMIN','get-termination-settlement-version',{draftId:r.id,revision:1});expect(first.statusCode).toBe(200);expect(JSON.parse(first.body).manual.items[0].amount).toBe('15000.00');expect((await asTerm('TERM','get-termination-settlement-version',{draftId:r.id,revision:1})).statusCode).toBe(403);expect((await asTerm('ADMIN','get-termination-settlement-version',{draftId:r.id,revision:1,month:'2026-09'})).statusCode).toBe(403);});
