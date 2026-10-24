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
import { UserRole, LeaveStatus } from '../types';

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

describe('independent B4a link capacity',()=>{
 const makeCase=(id='CASE')=>({id,empId:'SYNTH',revision:1,anchor:'card:C1',status:'open',observation:{window:{start:Date.parse('2026-04-01T09:00:00+08:00')/60000,end:Date.parse('2026-04-01T17:00:00+08:00')/60000}}});
 const login=()=>{fake.data.get('employees/SYNTH').role=UserRole.Employee;vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'SYNTH'} as any);};
 const draft={date:'2026-04-01',type:'下班',recordId:'C1',requestedClockOut:'18:00',reason:'合成補卡理由五字以上'};
 afterEach(()=>vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'ADMIN'} as any));
 it('101st request linked during submit must reject atomically instead of making case unreadable',async()=>{
 login();fake.data.set('attendanceCases/CASE',makeCase());for(let n=0;n<100;n++){const seeded=await call('submit-makeup-version',{...draft,operationId:'valid-prior-'+n,caseId:'CASE',expectedCaseRevision:1});expect(seeded.statusCode).toBe(200);}
 expect((await call('get-case-request-links',{caseId:'CASE'})).statusCode).toBe(200);const before=JSON.stringify([...fake.data]);
 const response=await call('submit-makeup-version',{...draft,operationId:'capacity-submit',caseId:'CASE',expectedCaseRevision:1});
 const read=await call('get-case-request-links',{caseId:'CASE'});console.log('capacity submit/read',response.statusCode,read.statusCode);
 expect(response.statusCode).toBe(409);expect(JSON.stringify([...fake.data])).toBe(before);
 });
 it('101st request link through link endpoint must reject atomically',async()=>{
 login();fake.data.set('attendanceCases/CASE',makeCase());for(let n=0;n<100;n++){const seeded=await call('submit-makeup-version',{...draft,operationId:'valid-prior-'+n,caseId:'CASE',expectedCaseRevision:1});expect(seeded.statusCode).toBe(200);}
 const created=await call('submit-makeup-version',{...draft,operationId:'unlinked'});expect(created.statusCode).toBe(200);const r=JSON.parse(created.body);const before=JSON.stringify([...fake.data]);
 const response=await call('link-case-request',{requestId:r.id,caseId:'CASE',mode:'link',operationId:'capacity-link',reason:'合成關聯理由五字',expectedRevision:1,expectedCaseRevision:1,expectedLinkRevision:0});
 console.log('capacity link/read',response.statusCode,(await call('get-case-request-links',{caseId:'CASE'})).statusCode);
 expect(response.statusCode).toBe(409);expect(JSON.stringify([...fake.data])).toBe(before);
 });
 it('request history cap remains atomic when approval would also write raw card/revision',async()=>{
 login();const made=await call('submit-makeup-version',{...draft,operationId:'history'});const r=JSON.parse(made.body);fake.data.get('makeupRequests/'+r.id).history=Array.from({length:200},(_,n)=>({id:'h'+n}));vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'ADMIN'} as any);
 const before=JSON.stringify([...fake.data]);expect((await call('act-makeup-request',{requestId:r.id,mode:'approve',expectedRevision:1,operationId:'full-history-approve',reason:'合成審核理由五字'})).statusCode).toBe(409);expect(JSON.stringify([...fake.data])).toBe(before);
 });
});
