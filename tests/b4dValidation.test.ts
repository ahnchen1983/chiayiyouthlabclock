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

describe('independent B4d quota unknown source',()=>{
 it.each([null,'','unknown-legacy'])('unknown existing status must not count as zero against confirmed quota %s',async(status)=>{const {assessLeavePolicy}=await import('../netlify/functions/utils/leavePolicy');fake.data.set('leavePolicyVersions/P',{version:'review-v1',status:'approved',approvedBy:'ADMIN',approvedAt:'2026-01-01T00:00:00Z',effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',employeeIds:['SYNTH'],leaveType:LeaveType.Personal,backdatedMaxDays:1000,quota:{periodStart:'2026-01-01',periodEnd:'2026-12-31',minutes:60,basis:'requested-span-minutes',reservePending:true}});fake.data.set('leaveRequests/UNKNOWN',{empId:'SYNTH',leaveType:LeaveType.Personal,status,startDate:'2026-04-01T09:00:00+08:00',endDate:'2026-04-01T10:00:00+08:00'});const promise=assessLeavePolicy(fake.db,{get:(r:any)=>r.get()},{empId:'SYNTH',leaveType:LeaveType.Personal,status:LeaveStatus.Pending,startDate:'2026-04-01T13:00:00+08:00',endDate:'2026-04-01T14:00:00+08:00'});await expect(promise).rejects.toMatchObject({statusCode:409});});

 it('real submission handler cannot confirm reservation while relevant existing status is unknown',async()=>{vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'SYNTH'} as any);fake.data.get('employees/SYNTH').role=UserRole.Employee;fake.data.set('leavePolicyVersions/P',{version:'review-v1',status:'approved',approvedBy:'ADMIN',approvedAt:'2026-01-01T00:00:00Z',effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',employeeIds:['SYNTH'],leaveType:LeaveType.Personal,backdatedMaxDays:1000,quota:{periodStart:'2026-01-01',periodEnd:'2026-12-31',minutes:60,basis:'requested-span-minutes',reservePending:true}});fake.data.set('leaveRequests/UNKNOWN',{empId:'SYNTH',leaveType:LeaveType.Personal,status:'unknown-legacy',startDate:'2026-04-01T09:00:00+08:00',endDate:'2026-04-01T10:00:00+08:00'});const before=JSON.stringify([...fake.data]);const r=await call('submit-leave-request',{leaveType:LeaveType.Personal,startDate:'2026-04-01T13:00:00+08:00',endDate:'2026-04-01T14:00:00+08:00',reason:'合成未知舊額度來源'});expect(r.statusCode).toBe(409);expect(JSON.stringify([...fake.data])).toBe(before);});
});
