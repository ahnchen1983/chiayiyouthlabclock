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
describe('handler integration with in-memory Firestore only; no credentials',()=>{
 it('Taiwan midnight writes the Taiwan workDate and absolute timestamp',async()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-05-01T00:30:00+08:00'));expect((await call('clock-in',{requestId:'synthetic-0001',verificationMethod:'IP'})).statusCode).toBe(200);const r=fake.data.get('clockRecords/ADMIN_synthetic-0001');expect(r.date).toBe('2026-05-01');expect(r.clockInAt).toBe('2026-04-30T16:30:00.000Z');});
 it('in/out retransmission is idempotent and a second session is possible',async()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-04-01T09:00:00+08:00'));const req={requestId:'synthetic-0001',verificationMethod:'IP'};await call('clock-in',req);await call('clock-in',req);vi.setSystemTime(new Date('2026-04-01T12:00:00+08:00'));expect((await call('clock-out')).statusCode).toBe(200);await call('clock-in',req);expect(fake.data.get('clockRecords/ADMIN_synthetic-0001').clockOutTime).toBe('12:00');vi.setSystemTime(new Date('2026-04-01T14:00:00+08:00'));expect((await call('clock-in',{...req,requestId:'synthetic-0002'})).statusCode).toBe(200);expect(fake.data.get('clockRecords/ADMIN_synthetic-0002').clockInTime).toBe('14:00');});
 it('editing the prior-day overnight schedule also protects the next locked month',async()=>{lock('2026-05');fake.data.set('dailySchedule/2026-04-30',{status:'營運',shifts:[{empId:'SYNTH',name:'synthetic',role:'partTime',from:'22:00',to:'06:00',endDateOffset:1}]});expect((await call('update-schedule',{event:{date:'2026-04-30',status:'營運',shifts:[]}})).statusCode).toBe(423);});
 it('rejects unauthorized salary access',async()=>{fake.data.set('employees/ADMIN',{id:'ADMIN',role:UserRole.Employee});expect((await call('get-employee-salary',{empId:'SYNTH',yearMonth:month})).statusCode).toBe(403);});
 it('locked schedule update is rejected',async()=>{lock();expect((await call('update-schedule',{event:{date:'2026-04-01',status:'營運',shifts:[]}})).statusCode).toBe(423);});
 it('locked template application is rejected',async()=>{lock();expect((await call('apply-template',{yearMonth:month})).statusCode).toBe(423);});
 it('global reset cannot touch a locked month',async()=>{lock();expect((await call('reset-all-schedule')).statusCode).toBe(423);});
 it('restore checks snapshot dates rather than claimed month',async()=>{lock();fake.data.set('scheduleVersions/V',{yearMonth:'2026-05',snapshot:{'2026-04-01':{status:'營運',shifts:[]}}});expect((await call('restore-schedule-version',{versionId:'V',reason:'synthetic restore'})).statusCode).toBe(423);});
 it.each(['claim-open-shift','release-open-shift','delete-open-shift'])('locked %s cannot mutate',async(action)=>{lock();fake.data.set('openShifts/O',{date:'2026-04-01',shiftTime:'09:00-17:00',status:'open',requiredCount:1,takenBy:[],takenNames:[]});expect((await call(action,{shiftId:'O'})).statusCode).toBe(423);});
 it('locked open shift creation rejected',async()=>{lock();expect((await call('create-open-shift',{date:'2026-04-01',shiftTime:'09:00-17:00',requiredCount:1})).statusCode).toBe(423);});
 it('leave approval checks end month too',async()=>{lock('2026-05');fake.data.set('leaveRequests/L',{empId:'SYNTH',status:LeaveStatus.Pending,startDate:'2026-04-30T13:00',endDate:'2026-05-01T17:00'});expect((await call('approve-leave',{requestId:'L',status:LeaveStatus.Approved})).statusCode).toBe(423);expect(fake.data.get('leaveRequests/L').status).toBe(LeaveStatus.Pending);});
 it('overlapping approved leave cannot be approved twice',async()=>{fake.data.set('leaveRequests/OLD',{empId:'SYNTH',status:LeaveStatus.Approved,startDate:'2026-04-01T13:00',endDate:'2026-04-01T17:00'});fake.data.set('leaveRequests/L',{empId:'SYNTH',status:LeaveStatus.Pending,startDate:'2026-04-01T14:00',endDate:'2026-04-01T16:00'});expect((await call('approve-leave',{requestId:'L',status:LeaveStatus.Approved})).statusCode).toBe(409);});
 it('locked card cannot be edited',async()=>{lock();expect((await call('update-clock-record',{recordId:'C1',clockOutTime:null})).statusCode).toBe(423);expect(fake.data.get('clockRecords/C1').clockOutTime).toBe('17:00');});
 it('card clearing is persisted with null work hours',async()=>{expect((await call('update-clock-record',{recordId:'C1',clockOutTime:null})).statusCode).toBe(200);expect(fake.data.get('clockRecords/C1').workHours).toBeNull();});
 it('makeup approval is idempotent and invalidates old work review',async()=>{fake.data.set('makeupRequests/M',{empId:'SYNTH',name:'synthetic',date:'2026-04-01',type:'下班',requestedClockOut:'18:00',reason:'synthetic',status:'待審核'});expect((await call('approve-makeup-request',{requestId:'M',status:'核准'})).statusCode).toBe(200);const size=fake.data.size;expect((await call('approve-makeup-request',{requestId:'M',status:'核准'})).statusCode).toBe(200);expect(fake.data.size).toBe(size);expect(fake.data.get('clockRecords/C1').workHours).toBeNull();});
 it('makeup transaction failure leaves request pending and card unchanged',async()=>{fake.data.set('makeupRequests/M',{empId:'SYNTH',date:'2026-04-01',requestedClockOut:'25:99',status:'待審核'});expect((await call('approve-makeup-request',{requestId:'M',status:'核准'})).statusCode).toBe(409);expect(fake.data.get('makeupRequests/M').status).toBe('待審核');expect(fake.data.get('clockRecords/C1').clockOutTime).toBe('17:00');});
 it('makeup crossing into a locked month is rejected',async()=>{lock('2026-05');fake.data.set('makeupRequests/M',{empId:'SYNTH',date:'2026-04-30',requestedClockInAt:'2026-04-30T22:00:00+08:00',requestedClockOutAt:'2026-05-01T06:00:00+08:00',status:'待審核'});expect((await call('approve-makeup-request',{requestId:'M',status:'核准'})).statusCode).toBe(423);});
 it('duplicate same-day makeup requires an explicit card identity',async()=>{fake.data.set('clockRecords/C2',card());fake.data.set('makeupRequests/M',{empId:'SYNTH',date:'2026-04-01',requestedClockOut:'18:00',status:'待審核'});expect((await call('approve-makeup-request',{requestId:'M',status:'核准'})).statusCode).toBe(409);});
 it('new month snapshot is atomic and stays fixed after rate changes',async()=>{const response=await call('lock-month',{yearMonth:month});expect(response.statusCode).toBe(200);const saved=JSON.parse(response.body);expect(saved.payrollRunId).toBeTruthy();fake.data.get('employees/SYNTH').hourlyRate=999;const salaries=JSON.parse((await call('get-all-salary-details',{yearMonth:month})).body);expect(salaries[0].grossSalary).toBe(1600);expect(salaries[0].calculationStatus).toBe('locked');});
 it('incomplete payroll cannot produce any lock or run',async()=>{fake.data.set('clockRecords/C1',card(undefined,'09:00',null,false));expect((await call('lock-month',{yearMonth:month})).statusCode).toBe(409);expect([...fake.data.keys()].some(k=>k.startsWith('monthLocks/')||k.startsWith('payrollRuns/'))).toBe(false);});
 it('legacy lock exposes pending instead of recalculated money',async()=>{lock();const result=JSON.parse((await call('get-employee-salary',{empId:'SYNTH',yearMonth:month})).body);expect(result.calculationStatus).toBe('legacy-review');expect(result.netSalary).toBeNull();});
 it('historical lock cannot be unlocked by this repair',async()=>{lock();expect((await call('unlock-month',{yearMonth:month,reason:'synthetic'})).statusCode).toBe(409);expect(fake.data.get(`monthLocks/${month}`).unlockedAt).toBeUndefined();});
});

describe('independent review API regressions',()=>{
 it('cannot lock missing second session',async()=>{const d=schedule(undefined,'09:00','12:00');d.shifts.push({...d.shifts[0],from:'14:00',to:'18:00'});fake.data.set('dailySchedule/'+d.date,d);fake.data.set('clockRecords/C1',card(undefined,'09:00','12:00'));expect((await call('lock-month',{yearMonth:month})).statusCode).toBe(409);expect(fake.data.has('monthLocks/'+month)).toBe(false);});
 it('rejects allocation outside approved window without updating leave',async()=>{const l=leave();fake.data.set('leaveRequests/L',l);expect((await call('review-leave-allocation',{requestId:'L',allocations:[{date:'2026-04-01',from:'09:00',to:'17:00',minutes:480}]})).statusCode).toBe(409);expect(fake.data.get('leaveRequests/L').payrollAllocations).toEqual(l.payrollAllocations);});
 it('explicit system account is excluded without fake future hire date',async()=>{expect((await call('lock-month',{yearMonth:month})).statusCode).toBe(200);expect(fake.data.get('monthLocks/'+month).employeeCount).toBe(1);});
 it('zero salary real employee still blocks settlement',async()=>{fake.data.get('employees/SYNTH').hourlyRate=0;expect((await call('lock-month',{yearMonth:month})).statusCode).toBe(409);});
 it('legacy unclassified admin requires explicit monthly nonemployee review',async()=>{const admin=fake.data.get('employees/ADMIN');delete admin.accountKind;expect((await call('lock-month',{yearMonth:month})).statusCode).toBe(409);expect((await call('review-payroll-inputs',{empId:'ADMIN',review:{yearMonth:month,participation:'system-account',participationReason:'僅系統登入，非受薪員工'}})).statusCode).toBe(200);expect((await call('lock-month',{yearMonth:month})).statusCode).toBe(200);});
});

describe('absolute time conflicts at settlement boundary',()=>{
 it.each(['2026-04-01','2026-03-31'])('cannot lock cross-day overlap from %s',async(date)=>{const next=date==='2026-03-31'?'2026-04-01':'2026-04-02';const r=card(date,'22:00','06:00',false);r.clockInAt=date+'T22:00:00+08:00';r.clockOutAt=next+'T06:00:00+08:00';r.workIntervals=[{start:1320,end:1800}];r.workReview={sourceKey:clockSourceKey(r),reviewedBy:'SYNTH',reviewedAt:review.reviewedAt};fake.data.set('clockRecords/C1',r);fake.data.set('clockRecords/C2',card(next,'02:00','10:00'));expect((await call('lock-month',{yearMonth:month})).statusCode).toBe(409);expect(fake.data.has('monthLocks/'+month)).toBe(false);});
});

describe('bounded payroll snapshot evidence',()=>{
 it('unrelated historical cards do not exhaust monthly snapshot capacity or get deleted',async()=>{for(let i=0;i<1000;i++)fake.data.set('clockRecords/OLD'+i,{...card('2025-01-01'),id:'OLD'+i,empId:i%2?'OTHER':'SYNTH',notes:'x'.repeat(800)});const response=await call('lock-month',{yearMonth:month});expect(response.statusCode).toBe(200);const run=fake.data.get('payrollRuns/'+JSON.parse(response.body).payrollRunId);expect(run.salaries[0].grossSalary).toBe(1600);expect(run.inputs.records.map(r=>r.id)).toEqual(['C1']);expect(fake.data.has('clockRecords/OLD999')).toBe(true);});
 it('retains complete adjacent-month evidence for included employees only',async()=>{fake.data.set('clockRecords/PREV',{...card('2026-03-31'),notes:'boundary evidence'});fake.data.set('clockRecords/NEXT',card('2026-05-01'));fake.data.set('clockRecords/OTHER',{...card('2026-03-31'),empId:'OTHER'});const response=await call('lock-month',{yearMonth:month});expect(response.statusCode).toBe(200);const run=fake.data.get('payrollRuns/'+JSON.parse(response.body).payrollRunId);expect(run.inputs.records.map(r=>r.date).sort()).toEqual(['2026-03-31','2026-04-01','2026-05-01']);expect(run.inputs.records.find(r=>r.date==='2026-03-31').notes).toBe('boundary evidence');expect(run.salaries[0].grossSalary).toBe(1600);});
 it('genuinely oversized relevant evidence fails atomically',async()=>{fake.data.get('clockRecords/C1').notes='x'.repeat(810000);const response=await call('lock-month',{yearMonth:month});expect(response.statusCode).toBe(409);expect(response.body).toContain('快照過大');expect([...fake.data.keys()].some(k=>k.startsWith('monthLocks/')||k.startsWith('payrollRuns/')||k.startsWith('payrollControl/'))).toBe(false);expect(fake.data.get('clockRecords/C1').notes.length).toBe(810000);});
});

describe('public bootstrap fails closed, existing login preserved',()=>{
 it('empty database initialization creates no account or template',async()=>{fake.data.clear();const response=await call('initialize-database');expect(response.statusCode).toBe(503);expect(fake.data.size).toBe(0);expect((await call('login',{empId:'ADMIN',password:randomUUID()})).body).toBe('null');expect(fake.data.has('employees/ADMIN')).toBe(false);});
 it('initialization cannot reset existing account and existing login works',async()=>{const password=randomUUID();const existing={...fake.data.get('employees/ADMIN'),password:hashPassword(password)};fake.data.set('employees/ADMIN',existing);expect((await call('initialize-database')).statusCode).toBe(503);expect(fake.data.get('employees/ADMIN')).toEqual(existing);const response=await call('login',{empId:'ADMIN',password});expect(JSON.parse(response.body).kind).toBe('success');expect(response.body).not.toContain(password);expect(response.body).not.toContain(existing.password);});
 it('login infrastructure errors never echo credential or underlying error',async()=>{const password=randomUUID(),sentinel=randomUUID();fake.data.get('employees/ADMIN').password=hashPassword(password);vi.mocked(adminAuth.createCustomToken).mockRejectedValueOnce(new Error(sentinel));const response=await call('login',{empId:'ADMIN',password});expect(response.statusCode).toBe(500);expect(response.body).not.toContain(sentinel);expect(response.body).not.toContain(password);expect(response.body).toContain('登入服務暫時無法使用');});
});

describe('payroll review access and explicit input contract', () => {
 it.each([UserRole.Employee, UserRole.Admin])('limits full review access to SuperAdmin (%s)', async role => {
  fake.data.get('employees/ADMIN').role = role;
  expect((await call('get-payroll-review-inputs', { yearMonth: month })).statusCode).toBe(403);
  expect((await call('review-payroll-inputs', { empId: employee.id, review })).statusCode).toBe(403);
 });
 it('returns payroll allowlisted inputs and approved intersecting leaves only, including when locked', async () => {
  const target = fake.data.get('employees/SYNTH');
  Object.assign(target, { password: 'private-password', email: 'private-email', phone: 'private-phone', address: 'private-address' });
  target.payrollReview = { ...structuredClone(review), hiddenContact: 'private-contact' };
  target.payrollReview.policy.overtimeTiers[0].contact = 'private-tier-contact';
  fake.data.set('leaveRequests/APPROVED', leave());
  fake.data.set('leaveRequests/BOUNDARY', { ...leave(), startDate: '2026-03-31T23:00', endDate: '2026-04-01T01:00' });
  fake.data.set('leaveRequests/PENDING', { ...leave(), status: LeaveStatus.Pending });
  fake.data.set('leaveRequests/NEXT', leave('2026-05-01'));
  fake.data.set('leaveRequests/UNRELATED', leave('2026-05-02'));
  lock();
  const response = await call('get-payroll-review-inputs', { yearMonth: month });
  expect(response.statusCode).toBe(200);
  const result = JSON.parse(response.body);
  expect(result.locked).toBe(true);
  expect(result.employees.find((e: any) => e.id === 'SYNTH')).toMatchObject({ name: employee.name, hourlyRate: 200, payrollReview: { yearMonth: month } });
  expect(result.employees.find((e: any) => e.id === 'ADMIN').role).toBe(UserRole.SuperAdmin);
  expect(result.leaves.map((l: any) => l.id).sort()).toEqual(['APPROVED', 'BOUNDARY', 'NEXT']);
  expect(response.body).not.toContain('private-');
 });
 it('rejects invalid getter month', async () => { expect((await call('get-payroll-review-inputs', { yearMonth: '2026-13' })).statusCode).toBe(400); });
 it('keeps review writes locked and leaves review untouched', async () => {
  lock(); const before = structuredClone(fake.data.get('employees/SYNTH').payrollReview);
  expect((await call('review-payroll-inputs', { empId: employee.id, review })).statusCode).toBe(423);
  expect(fake.data.get('employees/SYNTH').payrollReview).toEqual(before);
 });
 it('records server reviewer and time while preserving explicitly reviewed zero money', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-05-02T00:00:00Z'));
  const payload = { ...structuredClone(review), reviewedBy: 'forged-user', reviewedAt: 'forged-time', password: 'must-not-persist' };
  expect((await call('review-payroll-inputs', { empId: employee.id, review: payload })).statusCode).toBe(200);
  const saved = fake.data.get('payrollReviews/SYNTH_' + month).review;
  expect(saved).toMatchObject({ reviewedBy: 'ADMIN', reviewedAt: '2026-05-02T00:00:00.000Z', insurance: { labor: 0, health: 0, pensionSelf: 0 } });
  expect(saved.password).toBeUndefined();
 });
 const invalidInputs: [string, (r: any) => void][] = [
  ['missing policy', r => { delete r.policy; }],
  ['empty policy version', r => { r.policy.version = ' '; }],
  ['estimated hours', r => { r.policy.hoursBasis = 'schedule'; }],
  ['wrong daily minutes', r => { r.policy.dailyRegularMinutes = 360; }],
  ['wrong date rule', r => { r.policy.workDateRule = 'clock-out-date'; }],
  ['unconfirmed money precision', r => { r.policy.moneyDecimals = 1; }],
  ['nonexistent calendar date', r => { r.policy.regularDates = ['2026-04-31']; }],
  ['outside month date', r => { r.policy.regularDates = ['2026-05-01']; }],
  ['duplicate day', r => { r.policy.regularDates = ['2026-04-01', '2026-04-01']; }],
  ['zero tier minutes', r => { r.policy.overtimeTiers[0].minutes = 0; }],
  ['zero tier numerator', r => { r.policy.overtimeTiers[0].numerator = 0; }],
  ['infinite tier denominator', r => { r.policy.overtimeTiers[0].denominator = Infinity; }],
  ['fraction above one', r => { r.policy.hourlyLeavePaidFraction['特休'] = 1.1; }],
  ['negative fraction', r => { r.policy.monthlyLeaveDeductionFraction['特休'] = -0.1; }],
  ['missing fractions', r => { delete r.policy.hourlyLeavePaidFraction; }],
  ['missing insurance', r => { delete r.insurance; }],
  ['negative insurance', r => { r.insurance.labor = -1; }],
  ['string insurance', r => { r.insurance.health = '0'; }],
  ['infinite insurance', r => { r.insurance.pensionSelf = Infinity; }],
  ['missing insurance field', r => { delete r.insurance.health; }],
  ['unknown participation', r => { r.participation = 'employee'; }],
  ['invalid exception date', r => { r.scheduleExceptions = [{ date: '2026-05-01', reason: '明示理由', sourceKey: 'evidence' }]; }],
  ['empty exclusion reason', r => { r.participation = 'system-account'; r.participationReason = ' '; }],
 ];
 it.each(invalidInputs)('rejects %s without changing the stored review', async (_label, change) => {
  const before = structuredClone(fake.data.get('employees/SYNTH').payrollReview);
  const candidate = structuredClone(review); change(candidate);
  const result = await call('review-payroll-inputs', { empId: employee.id, review: candidate });
  expect(result.statusCode).toBe(400);
  expect(fake.data.get('employees/SYNTH').payrollReview).toEqual(before);
 });
 it('requires an explicit positive monthly hourly divisor for monthly employees', async () => {
  fake.data.get('employees/SYNTH').position = '專責人員';
  const payload = structuredClone(review); delete payload.policy.monthlyHourlyDivisor;
  expect((await call('review-payroll-inputs', { empId: employee.id, review: payload })).statusCode).toBe(400);
  payload.policy.monthlyHourlyDivisor = 240;
  expect((await call('review-payroll-inputs', { empId: employee.id, review: payload })).statusCode).toBe(200);
 });
 it('explicit system account exclusion needs a reason and no invented pay policy', async () => {
  expect((await call('review-payroll-inputs', { empId: 'ADMIN', review: { yearMonth: month, participation: 'system-account', participationReason: '僅登入管理系統' } })).statusCode).toBe(200);
  const saved = fake.data.get('payrollReviews/ADMIN_' + month).review;
  expect(saved).toMatchObject({ participation: 'system-account', reviewedBy: 'ADMIN' });
  expect(saved.policy).toBeUndefined(); expect(saved.insurance).toBeUndefined();
 });
 it('prevents ordinary employees from reading other employee details or all details', async () => {
  fake.data.get('employees/ADMIN').role = UserRole.Employee;
  expect((await call('get-all-employees-detail')).statusCode).toBe(403);
  expect((await call('get-employee', { empId: 'SYNTH' })).statusCode).toBe(403);
  expect((await call('get-employee', { empId: 'ADMIN' })).statusCode).toBe(200);
 });
 it('allows administrative employee detail access', async () => {
  fake.data.get('employees/ADMIN').role = UserRole.Admin;
  expect((await call('get-all-employees-detail')).statusCode).toBe(200);
  expect((await call('get-employee', { empId: 'SYNTH' })).statusCode).toBe(200);
 });
});


describe('leave allocation review locks and explicit payload', () => {
 it.each([{}, { requestId: '' }, { requestId: 'bad/path' }, { requestId: 'L', allocations: [] }, { requestId: 'L', allocations: { length: 1 } }, { requestId: 'L', allocations: [null] }])('rejects malformed allocation request (%j)', async payload => {
  fake.data.set('leaveRequests/L', leave());
  expect((await call('review-leave-allocation', payload)).statusCode).toBe(400);
 });
 it('protects old allocation months even when new approved bounds belong elsewhere', async () => {
  lock();
  const current = leave('2026-05-01');
  fake.data.set('leaveRequests/L', { ...current, payrollAllocations: leave().payrollAllocations });
  expect((await call('review-leave-allocation', { requestId: 'L', allocations: current.payrollAllocations })).statusCode).toBe(423);
  expect(fake.data.get('leaveRequests/L').payrollAllocations).toEqual(leave().payrollAllocations);
 });
 it('rechecks latest approved bounds after a concurrent source change', async () => {
  const current = leave('2026-05-01');
  fake.data.set('leaveRequests/L', leave()); lock('2026-05');
  const transaction = fake.db.runTransaction;
  fake.db.runTransaction = async (work: any) => { fake.data.set('leaveRequests/L', current); return transaction(work); };
  try {
   expect((await call('review-leave-allocation', { requestId: 'L', allocations: current.payrollAllocations })).statusCode).toBe(423);
   expect(fake.data.get('leaveRequests/L').payrollReviewedBy).toBeUndefined();
  } finally { fake.db.runTransaction = transaction; }
 });
});


describe('month-scoped payroll reviews preserve prior decisions and basis', () => {
 const reviewFor = (selectedMonth: string) => {
  const candidate = structuredClone(review); candidate.yearMonth = selectedMonth; candidate.policy.version = 'review-' + selectedMonth;
  const days = new Date(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 0).getDate();
  candidate.policy.regularDates = Array.from({ length: days }, (_, i) => `${selectedMonth}-${String(i + 1).padStart(2, '0')}`);
  return candidate;
 };
 it('retains two months when reviewed before either month locks', async () => {
  fake.data.set('clockRecords/MAY', card('2026-05-01'));
  for (const selectedMonth of [month, '2026-05']) expect((await call('review-payroll-inputs', { empId: employee.id, review: reviewFor(selectedMonth) })).statusCode).toBe(200);
  for (const selectedMonth of [month, '2026-05']) {
   const details = JSON.parse((await call('get-employee-salary', { empId: employee.id, yearMonth: selectedMonth })).body);
   expect(details).toMatchObject({ calculationStatus: 'ready', grossSalary: 1600, policyVersion: 'review-' + selectedMonth });
   const inputs = JSON.parse((await call('get-payroll-review-inputs', { yearMonth: selectedMonth })).body);
   expect(inputs.employees.find((e: any) => e.id === employee.id).payrollReview.yearMonth).toBe(selectedMonth);
   expect((await call('lock-month', { yearMonth: selectedMonth })).statusCode).toBe(200);
  }
  expect(fake.data.get('payrollReviews/SYNTH_2026-04')).toMatchObject({ empId: employee.id, yearMonth: month, review: { yearMonth: month, reviewedBy: 'ADMIN' } });
  expect(fake.data.get('payrollReviews/SYNTH_2026-05').review.policy.version).toBe('review-2026-05');
 });
 it('invalidates a scoped review after rate changes and never falls back to the legacy review', async () => {
  await call('review-payroll-inputs', { empId: employee.id, review });
  const priorKey = fake.data.get('payrollReviews/SYNTH_' + month).employeeSourceKey;
  expect((await call('update-employee', { empId: employee.id, updates: { hourlyRate: 250 } })).statusCode).toBe(200);
  // Even a legacy value matching this month cannot rescue the stale scoped document.
  fake.data.get('employees/SYNTH').payrollReview = structuredClone(review);
  const inputs = JSON.parse((await call('get-payroll-review-inputs', { yearMonth: month })).body);
  expect(inputs.employees.find((e: any) => e.id === employee.id).payrollReview).toBeNull();
  expect(JSON.parse((await call('get-employee-salary', { empId: employee.id, yearMonth: month })).body).calculationStatus).toBe('needs-review');
  expect((await call('lock-month', { yearMonth: month })).statusCode).toBe(409);
  expect(fake.data.has('monthLocks/' + month)).toBe(false);
  expect((await call('review-payroll-inputs', { empId: employee.id, review })).statusCode).toBe(200);
  expect(fake.data.get('payrollReviews/SYNTH_' + month).employeeSourceKey).not.toBe(priorKey);
  expect(JSON.parse((await call('get-employee-salary', { empId: employee.id, yearMonth: month })).body)).toMatchObject({ calculationStatus: 'ready', grossSalary: 2000 });
 });
 it.each([
  { monthlySalary: 35000 }, { position: '專責人員' }, { status: '留停' }, { hireDate: '2026-02-01' },
  { resignDate: '2026-04-30' }, { leaveOfAbsenceStart: '2026-04-10' }, { leaveOfAbsenceEnd: '2026-04-20' }, { laborPensionRate: 0.03 },
 ])('invalidates review if employment/pay basis changes (%j)', async updates => {
  await call('review-payroll-inputs', { empId: employee.id, review }); Object.assign(fake.data.get('employees/SYNTH'), updates);
  const inputs = JSON.parse((await call('get-payroll-review-inputs', { yearMonth: month })).body);
  expect(inputs.employees.find((e: any) => e.id === employee.id).payrollReview).toBeNull();
 });
 it('keeps a review valid after contact/name edits', async () => {
  await call('review-payroll-inputs', { empId: employee.id, review });
  Object.assign(fake.data.get('employees/SYNTH'), { name: '新名字', email: 'new@example.invalid', phone: 'new-contact' });
  const inputs = JSON.parse((await call('get-payroll-review-inputs', { yearMonth: month })).body);
  expect(inputs.employees.find((e: any) => e.id === employee.id).payrollReview).toMatchObject({ yearMonth: month, reviewedBy: 'ADMIN' });
 });
 it('preserves frozen scoped-review salary after later source changes', async () => {
  await call('review-payroll-inputs', { empId: employee.id, review });
  expect((await call('lock-month', { yearMonth: month })).statusCode).toBe(200);
  fake.data.get('employees/SYNTH').hourlyRate = 999;
  expect(JSON.parse((await call('get-employee-salary', { empId: employee.id, yearMonth: month })).body)).toMatchObject({ calculationStatus: 'locked', grossSalary: 1600 });
 });
 it('does not fallback from a present invalid month document', async () => {
  await call('review-payroll-inputs', { empId: employee.id, review });
  fake.data.get('payrollReviews/SYNTH_' + month).empId = 'OTHER';
  const inputs = JSON.parse((await call('get-payroll-review-inputs', { yearMonth: month })).body);
  expect(inputs.employees.find((e: any) => e.id === employee.id).payrollReview).toBeNull();
 });
});


describe('review form evidence read/save contract', () => {
 it('returns uncovered schedule evidence with employee identity for explicit exceptions', async () => {
  const event = schedule('2026-04-02'); fake.data.set('dailySchedule/' + event.date, event);
  const result = JSON.parse((await call('get-payroll-review-inputs', { yearMonth: month })).body);
  expect(result.scheduleGaps).toEqual([expect.objectContaining({ empId: employee.id, date: event.date, scheduledMinutes: 480, coveredMinutes: 0, sourceKey: expect.any(String) })]);
  const target = result.employees.find((e: any) => e.id === employee.id);
  expect(target.employeeSourceKey).toMatch(/^[a-f0-9]{64}$/);
  const candidate = structuredClone(review); candidate.scheduleExceptions = [{ date: event.date, reason: '當日班次取消，已核實', sourceKey: result.scheduleGaps[0].sourceKey }];
  expect((await call('review-payroll-inputs', { empId: employee.id, review: candidate, expectedEmployeeSourceKey: target.employeeSourceKey })).statusCode).toBe(200);
  expect(JSON.parse((await call('get-employee-salary', { empId: employee.id, yearMonth: month })).body)).toMatchObject({ calculationStatus: 'ready', grossSalary: 1600 });
 });
 it('rejects a stale form basis without persisting a new monthly review', async () => {
  const result = JSON.parse((await call('get-payroll-review-inputs', { yearMonth: month })).body);
  const sourceKey = result.employees.find((e: any) => e.id === employee.id).employeeSourceKey;
  fake.data.get('employees/SYNTH').hourlyRate = 300;
  const response = await call('review-payroll-inputs', { empId: employee.id, review, expectedEmployeeSourceKey: sourceKey });
  expect(response.statusCode).toBe(409); expect(response.body).toContain('重新載入');
  expect(fake.data.has('payrollReviews/SYNTH_' + month)).toBe(false);
 });
});


describe('schedule gap record identity stays consistent from preview through settlement', () => {
 it('can review a partial-session gap even when a legacy embedded card id differs from the document id', async () => {
  fake.data.set('clockRecords/C1', card('2026-04-01', '09:00', '12:00'));
  const event = schedule(); fake.data.set('dailySchedule/' + event.date, event);
  const result = JSON.parse((await call('get-payroll-review-inputs', { yearMonth: month })).body);
  expect(result.scheduleGaps).toEqual([expect.objectContaining({ empId: employee.id, date: event.date, scheduledMinutes: 480, coveredMinutes: 180 })]);
  const candidate = structuredClone(review); candidate.scheduleExceptions = [{ date: event.date, reason: '核實提早離場，剩餘班次取消', sourceKey: result.scheduleGaps[0].sourceKey }];
  expect((await call('review-payroll-inputs', { empId: employee.id, review: candidate })).statusCode).toBe(200);
  expect(JSON.parse((await call('get-employee-salary', { empId: employee.id, yearMonth: month })).body)).toMatchObject({ calculationStatus: 'ready', grossSalary: 600 });
  const response = await call('lock-month', { yearMonth: month }); expect(response.statusCode).toBe(200);
  const run = fake.data.get('payrollRuns/' + JSON.parse(response.body).payrollRunId);
  expect(run.inputs.records[0].id).toBe('C1'); expect(run.salaries[0]).toMatchObject({ calculationStatus: 'locked', grossSalary: 600 });
 });
});

describe('preflight locks use the same result as salary reads',()=>{
 it.each(['leaveRequests','makeupRequests','leaveOfAbsenceRequests'])('pending %s blocks API settlement without partial writes',async collection=>{
  fake.data.set(collection+'/PENDING',{id:'PENDING',empId:'SYNTH',status:'待審核',date:'2026-04-01',startDate:'2026-04-01T13:00',endDate:'2026-04-01T17:00'});
  const salary=JSON.parse((await call('get-employee-salary',{empId:'SYNTH',yearMonth:month})).body);
  expect(salary.preflight.status).toBe('BLOCKED');expect(salary.netSalary).toBeNull();
  const response=await call('lock-month',{yearMonth:month});expect(response.statusCode).toBe(409);expect(response.body).toContain('BLOCKED');
  expect([...fake.data.keys()].some(k=>k.startsWith('payrollRuns/')||k.startsWith('monthLocks/')||k.startsWith('payrollControl/'))).toBe(false);
 });
 it('pending swap for the receiving employee blocks settlement',async()=>{fake.data.set('shiftSwapRequests/S',{id:'S',fromEmpId:'OTHER',toEmpId:'SYNTH',fromDate:'2026-04-01',toDate:'2026-04-02',status:'awaiting-peer'});expect((await call('lock-month',{yearMonth:month})).statusCode).toBe(409);});
 it('after explicit rejection, re-read and lock agree on READY',async()=>{fake.data.set('makeupRequests/P',{empId:'SYNTH',date:'2026-04-01',status:'待審核'});expect((await call('lock-month',{yearMonth:month})).statusCode).toBe(409);expect((await call('approve-makeup-request',{requestId:'P',status:'駁回',rejectReason:'synthetic resolved'})).statusCode).toBe(200);const salaries=JSON.parse((await call('get-all-salary-details',{yearMonth:month})).body);expect(salaries[0].preflight.trialStatus).toBe('READY');expect((await call('lock-month',{yearMonth:month})).statusCode).toBe(200);});
 it('new pending makeup after a lock cannot be inserted',async()=>{lock();const r=await call('submit-makeup-request',{date:'2026-04-01',type:'下班',requestedClockOut:'18:00',reason:'synthetic correction'});expect(r.statusCode).toBe(423);expect([...fake.data.keys()].some(k=>k.startsWith('makeupRequests/'))).toBe(false);});
 it('legacy locked snapshot reads are not rewritten by live pending requests',async()=>{expect((await call('lock-month',{yearMonth:month})).statusCode).toBe(200);fake.data.set('makeupRequests/LATE',{empId:'SYNTH',date:'2026-04-01',status:'待審核'});const salary=JSON.parse((await call('get-employee-salary',{empId:'SYNTH',yearMonth:month})).body);expect(salary.calculationStatus).toBe('locked');expect(salary.netSalary).toBe(1600);});
});

describe('unmocked formal eligibility and applied correction evidence',()=>{
 beforeEach(async()=>{const actual=await vi.importActual<typeof import('../netlify/functions/utils/payrollPreflight')>('../netlify/functions/utils/payrollPreflight');vi.mocked(assertPayrollReady).mockImplementation(actual.assertPayrollReady);});
 it('required missing capabilities block every new formal lock without any writes while retaining1600 trial',async()=>{
  const result=JSON.parse((await call('get-employee-salary',{empId:'SYNTH',yearMonth:month})).body);
  expect(result.preflight).toMatchObject({status:'BLOCKED',trialStatus:'READY'});expect(result.netSalary).toBe(1600);
  const before=JSON.stringify([...fake.data]);expect((await call('lock-month',{yearMonth:month,skipGaps:true,confirmation:'all verified'})).statusCode).toBe(409);expect(JSON.stringify([...fake.data])).toBe(before);
 });
 it('approved18:00 without application evidence cannot pass trial with current17:00',async()=>{
  fake.data.set('makeupRequests/P',{empId:'SYNTH',date:'2026-04-01',recordId:'C1',status:'核准',requestedClockOut:'18:00',approver:'ADMIN',approvalDate:review.reviewedAt});
  const salary=JSON.parse((await call('get-employee-salary',{empId:'SYNTH',yearMonth:month})).body);expect(salary.preflight.trialStatus).toBe('NEEDS_REVIEW');expect(salary.preflight.issues.some(i=>i.code==='APPLICATION_UNVERIFIED')).toBe(true);expect(salary.netSalary).toBeNull();expect((await call('lock-month',{yearMonth:month})).statusCode).toBe(409);
 });
 it('application is atomic, idempotent, preserves raw before evidence and follows later legitimate correction',async()=>{
  const raw=structuredClone(fake.data.get('clockRecords/C1'));
  fake.data.set('makeupRequests/P',{empId:'SYNTH',date:'2026-04-01',recordId:'C1',status:'待審核',requestedClockOut:'18:00'});
  expect((await call('approve-makeup-request',{requestId:'P',status:'核准'})).statusCode).toBe(200);
  const applied=fake.data.get('makeupRequests/P').appliedEvidence;expect(applied.revisionId).toBeTruthy();
  const originalRevision=structuredClone(fake.data.get('attendanceRevisions/'+applied.revisionId));expect(originalRevision.before).toMatchObject(raw);expect(originalRevision.before.clockOutTime).toBe('17:00');expect(originalRevision.after.clockOutTime).toBe('18:00');
  const afterFirst=JSON.stringify([...fake.data]);expect((await call('approve-makeup-request',{requestId:'P',status:'核准'})).statusCode).toBe(200);
  expect([...fake.data.keys()].filter(k=>k.startsWith('attendanceRevisions/'))).toHaveLength(1);
  expect(fake.data.get('makeupRequests/P').appliedEvidence).toEqual(applied);
  expect((await call('update-clock-record',{recordId:'C1',clockInTime:'09:00',clockOutTime:'17:00',workIntervals:[{start:540,end:1020}]})).statusCode).toBe(200);
  const salary=JSON.parse((await call('get-employee-salary',{empId:'SYNTH',yearMonth:month})).body);expect(salary.preflight.trialStatus).toBe('READY');expect(salary.netSalary).toBe(1600);expect(salary.preflight.status).toBe('BLOCKED');
  expect(fake.data.get('attendanceRevisions/'+applied.revisionId)).toEqual(originalRevision);
  fake.data.get('clockRecords/C1').attendanceRevisionId='MISSING';
  expect(JSON.parse((await call('get-employee-salary',{empId:'SYNTH',yearMonth:month})).body).preflight.trialStatus).toBe('NEEDS_REVIEW');
 });
 it('locked correction approval leaves request, card and revision collections unchanged',async()=>{
  lock();fake.data.set('makeupRequests/P',{empId:'SYNTH',date:'2026-04-01',recordId:'C1',status:'待審核',requestedClockOut:'18:00'});const before=JSON.stringify([...fake.data]);expect((await call('approve-makeup-request',{requestId:'P',status:'核准'})).statusCode).toBe(423);expect(JSON.stringify([...fake.data])).toBe(before);
 });
});

describe('B2 scoped case API with server evidence only',()=>{
 afterEach(()=>vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'ADMIN'} as any));
 const scan=()=>call('scan-attendance-cases',{empId:'SYNTH',yearMonth:month});
 const cases=()=>[...fake.data.entries()].filter(([k])=>k.startsWith('attendanceCases/')).map(([,v])=>v);
 const seed=async()=>{fake.data.set('clockRecords/C1',{...card(undefined,null,'17:00',false),id:'C1'});const r=await scan();expect(r.statusCode,r.body).toBe(200);return cases().find(c=>c.type==='missing-in'&&c.anchor==='card:C1');};
 const command=(c:any,mode:string,id=mode)=>({caseId:c.id,mode,operationId:id,reason:'synthetic reviewed action',expectedRevision:c.revision,expectedEvidenceVersion:c.observation.evidenceVersion});
 it('scan rerun dedupes case, immutable audit and held sandbox outbox',async()=>{
  await seed();const count=(p:string)=>[...fake.data.keys()].filter(k=>k.startsWith(p+'/')).length;
  const before=['attendanceCases','attendanceCaseEvents','attendanceCaseOutbox'].map(count);expect(before[0]).toBeGreaterThan(0);expect((await scan()).statusCode).toBe(200);expect(['attendanceCases','attendanceCaseEvents','attendanceCaseOutbox'].map(count)).toEqual(before);
  expect([...fake.data.entries()].filter(([k])=>k.startsWith('attendanceCaseOutbox/')).every(([,v])=>v.state==='held'&&v.channel==='sandbox')).toBe(true);
 });
 it('employee sees only own redacted cases, can explain but cannot assign/scan/resolve',async()=>{
  const c=await seed();vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'SYNTH'} as any);fake.data.get('employees/SYNTH').role=UserRole.Employee;
  expect((await call('get-attendance-case',{caseId:c.id})).statusCode).toBe(200);
  const response=await call('list-attendance-cases',{empId:'SYNTH',yearMonth:month});expect(response.statusCode).toBe(200);expect(response.body).not.toContain('hourlyRate');expect(response.body).not.toContain('verificationData');expect(response.body).not.toContain('requestSourceKey');
  expect((await call('list-attendance-cases',{empId:'ADMIN',yearMonth:month})).statusCode).toBe(403);expect((await scan()).statusCode).toBe(403);
  for(const mode of ['resolve','reopen','assign'])expect((await call('act-attendance-case',command(c,mode))).statusCode).toBe(403);
  expect((await call('act-attendance-case',command(c,'explain'))).statusCode).toBe(200);expect(fake.data.get('attendanceCases/'+c.id).status).toBe('awaiting-review');
 });
 it('repeated explanation is idempotent, stale version and changed replay rejected',async()=>{
  const c=await seed(),cmd=command(c,'explain');expect((await call('act-attendance-case',cmd)).statusCode).toBe(200);const count=[...fake.data.keys()].filter(k=>k.startsWith('attendanceCaseEvents/')).length;expect((await call('act-attendance-case',cmd)).statusCode).toBe(200);expect([...fake.data.keys()].filter(k=>k.startsWith('attendanceCaseEvents/')).length).toBe(count);
  expect((await call('act-attendance-case',{...cmd,operationId:'other'})).statusCode).toBe(409);expect((await call('act-attendance-case',{...cmd,reason:'changed'})).statusCode).toBe(409);
 });
 it('forged proof is rejected and resolve/reopen use fresh actual source',async()=>{
  const c=await seed();expect((await call('act-attendance-case',{...command(c,'resolve'),proof:{outcome:'clear'}})).statusCode).toBe(400);expect((await call('act-attendance-case',command(c,'resolve'))).statusCode).toBe(409);
  expect((await call('update-clock-record',{recordId:'C1',clockInTime:'09:00',clockOutTime:'17:00',workIntervals:[{start:540,end:1020}]})).statusCode).toBe(200);
  expect((await call('act-attendance-case',command(c,'resolve','resolved'))).statusCode).toBe(200);const closed=fake.data.get('attendanceCases/'+c.id);expect(closed.status).toBe('resolved');expect(closed.history.length).toBeGreaterThan(c.history.length);
  expect((await call('act-attendance-case',command(closed,'reopen'))).statusCode).toBe(409);
  await call('update-clock-record',{recordId:'C1',clockInTime:null});expect((await call('act-attendance-case',command(closed,'reopen'))).statusCode).toBe(200);expect(fake.data.get('attendanceCases/'+c.id).status).toBe('open');
 });
 it('assign validates existing manager role and never grants employee approval rights',async()=>{
  const c=await seed();fake.data.get('employees/SYNTH').role=UserRole.Employee;expect((await call('act-attendance-case',{...command(c,'assign'),owner:'SYNTH'})).statusCode).toBe(403);expect((await call('act-attendance-case',{...command(c,'assign'),owner:'ADMIN'})).statusCode).toBe(200);expect(fake.data.get('attendanceCases/'+c.id).owner).toBe('ADMIN');
 });
 it('locked month rejects scan and case mutation without partial history/outbox writes',async()=>{
  const c=await seed();lock();const before=JSON.stringify([...fake.data]);expect((await scan()).statusCode).toBe(423);expect((await call('act-attendance-case',command(c,'explain'))).statusCode).toBe(423);expect(JSON.stringify([...fake.data])).toBe(before);
 });
 it('persisted unresolved cases enter preflight; missing complete workflow still formally blocks',async()=>{
  await seed();const salary=JSON.parse((await call('get-employee-salary',{empId:'SYNTH',yearMonth:month})).body);expect(salary.preflight.status).toBe('BLOCKED');expect(salary.preflight.issues.some(i=>i.code==='CASE_UNRESOLVED')).toBe(true);expect(salary.preflight.gaps).toContain('ATTENDANCE_CASE_WORKFLOW');
 });
});

it('B2 legacy name-only schedule remains unknown without guessing an employee ID',async()=>{
 fake.data.set('dailySchedule/2026-04-01',{status:'營運',staffA:'合成員工',shiftTime:'09:00-17:00'});
 expect((await call('scan-attendance-cases',{empId:'SYNTH',yearMonth:month})).statusCode).toBe(200);
 const cases=[...fake.data.entries()].filter(([k])=>k.startsWith('attendanceCases/')).map(([,v])=>v);
 expect(cases.some(c=>c.type==='unscheduled-card'&&c.observation.outcome==='unknown')).toBe(true);
});
it('B2 incomplete source scan aborts atomically at the bounded read limit',async()=>{
 for(let i=0;i<501;i++)fake.data.set('clockRecords/BOUND'+i,{...card(),id:'BOUND'+i});
 const response=await call('scan-attendance-cases',{empId:'SYNTH',yearMonth:month});expect(response.statusCode).toBe(409);
 expect([...fake.data.keys()].some(k=>k.startsWith('attendanceCases/')||k.startsWith('attendanceCaseOutbox/')||k.startsWith('payrollControl/'))).toBe(false);
});
it('B2 unknown scope cases keep distinct month identities instead of overwriting prior-month evidence',async()=>{
 for(const yearMonth of [month,'2026-05'])expect((await call('scan-attendance-cases',{empId:'SYNTH',yearMonth})).statusCode).toBe(200);
 const all=[...fake.data.entries()].filter(([k])=>k.startsWith('attendanceCases/')).map(([,v])=>v);
 const a=all.find(c=>c.anchor==='scope:2026-04'&&c.type==='pending-request'),b=all.find(c=>c.anchor==='scope:2026-05'&&c.type==='pending-request');
 expect(a).toBeTruthy();expect(b).toBeTruthy();expect(a.id).not.toBe(b.id);
});

describe('B3 case view API contract',()=>{
 afterEach(()=>vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'ADMIN'} as any));
 const seed=async()=>{await call('scan-attendance-cases',{empId:'SYNTH',yearMonth:month});return [...fake.data.entries()].find(([k])=>k.startsWith('attendanceCases/'))![1];};
 it('filters before pagination and does not omit matching cases after 50 unrelated rows',async()=>{
  const c=await seed();for(let i=0;i<60;i++)fake.data.set('attendanceCases/a'+String(i).padStart(2,'0'),{...c,type:'late',status:'open'});
  for(let i=0;i<51;i++)fake.data.set('attendanceCases/z'+String(i).padStart(2,'0'),{...c,type:'pending-request',status:'needs-info'});
  const q={empId:'SYNTH',yearMonth:month,type:'pending-request',status:'needs-info'};
  const first=JSON.parse((await call('list-attendance-cases',q)).body);expect(first.cases).toHaveLength(50);expect(first.cases.every(c=>c.status==='needs-info'&&c.type==='pending-request')).toBe(true);
  const next=JSON.parse((await call('list-attendance-cases',{...q,afterId:first.nextCursor})).body);expect(next.cases.length).toBeGreaterThan(0);expect(next.cases.every(c=>!first.cases.some(a=>a.id===c.id))).toBe(true);
  expect((await call('list-attendance-cases',{...q,status:'bogus'})).statusCode).toBe(400);
 });
 it('notification summary is readonly and redacted, including failed sandbox delivery',async()=>{
  const c=await seed();fake.data.set('attendanceCaseOutbox/extra',{caseId:c.id,state:'dead-letter',channel:'sandbox',leaseToken:'private-lease',recipientId:'private-recipient',deliveryEvidence:'private-receipt'});
  const before=JSON.stringify([...fake.data]);const r=await call('get-attendance-case',{caseId:c.id});expect(r.statusCode).toBe(200);const n=JSON.parse(r.body).notifications;
  expect(n).toMatchObject({mode:'sandbox-only',complete:true,deliveryEnabled:false});expect(n.counts['dead-letter']).toBe(1);
  for(const value of ['private-lease','private-recipient','private-receipt','hourlyRate'])expect(r.body).not.toContain(value);
  expect(JSON.stringify([...fake.data])).toBe(before);
 });
 it('notification read shares case scope and incomplete summary cannot claim full delivery',async()=>{
  const c=await seed();for(let i=0;i<501;i++)fake.data.set('attendanceCaseOutbox/large'+i,{caseId:c.id,state:'held',channel:'sandbox'});
  expect(JSON.parse((await call('get-attendance-case',{caseId:c.id})).body).notifications.complete).toBe(false);
  fake.data.set('employees/OTHER',{role:UserRole.Employee});vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'OTHER'} as any);
  expect((await call('get-attendance-case',{caseId:c.id})).statusCode).toBe(403);
 });
});

describe('B4a versioned makeup lifecycle and persistent case links',()=>{
 afterEach(()=>vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'ADMIN'} as any));
 const login=(who='SYNTH')=>{fake.data.get('employees/SYNTH').role=UserRole.Employee;vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:who} as any);};
 const draft={date:'2026-04-01',type:'下班',recordId:'C1',requestedClockOut:'18:00',reason:'合成補卡理由待核實'};
 const make=async(extra:any={})=>{login();const r=await call('submit-makeup-version',{...draft,operationId:'create-one',...extra});expect(r.statusCode,r.body).toBe(200);return JSON.parse(r.body);};
 const act=(r:any,mode:string,extra:any={})=>call('act-makeup-request',{requestId:r.id,mode,expectedRevision:r.revision??0,operationId:mode+'-one',reason:'合成處理原因五字以上',...extra});
 const linked=async()=>{fake.data.set('clockRecords/C1',{...card(undefined,null,'17:00',false),id:'C1'});await call('scan-attendance-cases',{empId:'SYNTH',yearMonth:month});const c=[...fake.data.entries()].find(([k,v])=>k.startsWith('attendanceCases/')&&v.type==='missing-in'&&v.anchor==='card:C1')![1];const r=await make({caseId:c.id,expectedCaseRevision:c.revision,type:'上班',requestedClockIn:'09:00',requestedClockOut:null});return {c,r};};
 it('submit is atomic and operation retries preserve exactly one request/event',async()=>{const r=await make();expect(r.revision).toBe(1);const before=JSON.stringify([...fake.data].filter(([k])=>!k.startsWith('payrollControl/')));expect((await call('submit-makeup-version',{...draft,operationId:'create-one'})).statusCode).toBe(200);expect(JSON.stringify([...fake.data].filter(([k])=>!k.startsWith('payrollControl/')))).toBe(before);expect((await call('submit-makeup-version',{...draft,operationId:'create-one',reason:'不同內容不得沿用'})).statusCode).toBe(409);});
 it('return/resubmit creates a new request identity, preserves original fields/history and requires another actor to approve',async()=>{const r=await make();expect((await act(r,'return')).statusCode).toBe(403);login('ADMIN');const returned=JSON.parse((await act(r,'return')).body);expect(returned.status).toBe('待補件');login();const nextResponse=await act(returned,'resubmit',{patch:{...draft,requestedClockOut:'19:00'}});expect(nextResponse.statusCode,nextResponse.body).toBe(200);const next=JSON.parse(nextResponse.body);expect(next.supersedesRequestId).toBe(r.id);expect(next.id).not.toBe(r.id);const old=fake.data.get('makeupRequests/'+r.id);expect(old.status).toBe('已取代');expect(old.requestedClockOut).toBe('18:00');expect(old.history).toHaveLength(3);expect((await act(returned,'resubmit',{operationId:'stale',patch:draft})).statusCode).toBe(409);expect((await act(next,'approve')).statusCode).toBe(403);});
 it('approval uses immutable raw revision evidence, duplicate operation applies once, cannot cancel or use legacy bypass',async()=>{const raw=fake.data.get('clockRecords/C1'),r=await make();login('ADMIN');const response=await act(r,'approve');expect(response.statusCode,response.body).toBe(200);const approved=JSON.parse(response.body);expect(approved.status).toBe('核准');expect(hasAppliedMakeup(approved,[fake.data.get('clockRecords/C1')],[...fake.data.entries()].filter(([k])=>k.startsWith('attendanceRevisions/')).map(([k,v])=>({...v,id:k.split('/')[1]})))).toBe(true);const revs=[...fake.data.entries()].filter(([k])=>k.startsWith('attendanceRevisions/'));expect(revs).toHaveLength(1);expect(revs[0][1].before.clockOutTime).toBe(raw.clockOutTime);expect((await act(r,'approve')).statusCode).toBe(200);expect([...fake.data.keys()].filter(k=>k.startsWith('attendanceRevisions/'))).toHaveLength(1);expect((await call('approve-makeup-request',{requestId:r.id,status:'核准'})).statusCode).toBe(409);login();expect((await act(approved,'cancel')).statusCode).toBe(409);});
 it('cancel/unlink never removes case, raw card or original link audit',async()=>{const {c,r}=await linked();const before=fake.data.get('attendanceCases/'+c.id),raw=fake.data.get('clockRecords/C1');const cancelled=JSON.parse((await act(r,'cancel')).body);const l=[...fake.data.entries()].find(([k])=>k.startsWith('caseRequestLinks/'))![1];expect((await call('link-case-request',{caseId:c.id,requestId:r.id,mode:'unlink',expectedRevision:cancelled.revision,expectedCaseRevision:c.revision,expectedLinkRevision:l.revision,operationId:'unlink',reason:'合成解除錯誤關聯'})).statusCode).toBe(200);expect(fake.data.get('attendanceCases/'+c.id)).toEqual(before);expect(fake.data.get('clockRecords/C1')).toEqual(raw);expect([...fake.data.keys()].filter(k=>k.startsWith('caseRequestLinkEvents/'))).toHaveLength(2);const salary=JSON.parse((await call('get-employee-salary',{empId:'SYNTH',yearMonth:month})).body);expect(salary.preflight.status).toBe('BLOCKED');expect(salary.preflight.issues.some(i=>i.code==='CASE_UNRESOLVED')).toBe(true);});
 it('resubmission retains old links and atomically links new version to each active case',async()=>{const {c,r}=await linked();login('ADMIN');const returned=JSON.parse((await act(r,'return')).body);login();const out=await act(returned,'resubmit',{patch:{date:r.date,type:r.type,recordId:'C1',requestedClockIn:'09:01'}});expect(out.statusCode,out.body).toBe(200);const next=JSON.parse(out.body),links=[...fake.data.entries()].filter(([k])=>k.startsWith('caseRequestLinks/')).map(([,v])=>v);expect(links.map(l=>l.requestId).sort()).toEqual([r.id,next.id].sort());expect(links.every(l=>l.caseId===c.id)).toBe(true);});
 it('forbids foreign employee/card and stale or unrelated case context',async()=>{const {c}=await linked();login();expect((await call('submit-makeup-version',{...draft,operationId:'foreign',empId:'ADMIN'})).statusCode).toBe(400);fake.data.set('clockRecords/FOREIGN',{...card(),empId:'OTHER'});expect((await call('submit-makeup-version',{...draft,operationId:'badcard',recordId:'FOREIGN'})).statusCode).toBe(403);expect((await call('submit-makeup-version',{...draft,operationId:'stale-case',caseId:c.id,expectedCaseRevision:0})).statusCode).toBe(409);expect((await call('get-makeup-request-detail',{requestId:'missing'})).statusCode).toBe(404);});
 it.each(['cancel','return','approve','reject','resubmit'])('locked month blocks %s without partial mutation',async mode=>{const r=await make();if(mode==='resubmit'){fake.data.get('makeupRequests/'+r.id).status='待補件';r.status='待補件';}if(['return','approve','reject'].includes(mode))login('ADMIN');lock();const before=JSON.stringify([...fake.data]);expect((await act(r,mode,{patch:draft})).statusCode).toBe(423);expect(JSON.stringify([...fake.data])).toBe(before);});
 it('full cross-month request and case window guard all affected months',async()=>{login();lock('2026-05');const before=JSON.stringify([...fake.data]);const response=await call('submit-makeup-version',{operationId:'overnight',date:'2026-04-30',type:'上下班',requestedClockInAt:'2026-04-30T22:00:00+08:00',requestedClockOutAt:'2026-05-01T06:00:00+08:00',reason:'合成跨月完整時間'});expect(response.statusCode).toBe(423);expect(JSON.stringify([...fake.data])).toBe(before);});
 it('legacy rejection also respects locked month',async()=>{fake.data.set('makeupRequests/LEGACY',{empId:'SYNTH',date:'2026-04-01',status:'待審核'});lock();expect((await call('approve-makeup-request',{requestId:'LEGACY',status:'駁回',rejectReason:'拒絕'})).statusCode).toBe(423);});
});
it('B4a rejects an invalid corrected clock order and ambiguous legacy overnight before writing',async()=>{
 fake.data.get('employees/SYNTH').role=UserRole.Employee;vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'SYNTH'} as any);
 const created=await call('submit-makeup-version',{operationId:'chronology',date:'2026-04-01',type:'下班',recordId:'C1',requestedClockOut:'08:00',reason:'合成時序需核實'});expect(created.statusCode).toBe(200);const r=JSON.parse(created.body);vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'ADMIN'} as any);const before=JSON.stringify([...fake.data]);
 expect((await call('act-makeup-request',{requestId:r.id,mode:'approve',expectedRevision:1,operationId:'invalid-approval',reason:'合成核實順序'})).statusCode).toBe(409);expect(JSON.stringify([...fake.data])).toBe(before);
 fake.data.get('clockRecords/C1').clockOutAt='2026-04-02T06:00:00+08:00';fake.data.get('makeupRequests/'+r.id).requestedClockOut='18:00';
 expect((await call('act-makeup-request',{requestId:r.id,mode:'approve',expectedRevision:1,operationId:'ambiguous-approval',reason:'合成跨夜需完整日期'})).statusCode).toBe(409);expect(fake.data.get('makeupRequests/'+r.id).status).toBe('待審核');
});
it('B4a cached receipts remain scoped after manager authority is revoked',async()=>{
 fake.data.get('employees/SYNTH').role=UserRole.Employee;vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'SYNTH'} as any);
 const r=JSON.parse((await call('submit-makeup-version',{operationId:'receipt-create',date:'2026-04-01',type:'下班',recordId:'C1',requestedClockOut:'18:00',reason:'合成申請理由五字'})).body);
 vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'ADMIN'} as any);const cmd={requestId:r.id,mode:'return',operationId:'receipt-return',expectedRevision:1,reason:'請補件核實完整資料'};
 expect((await call('act-makeup-request',cmd)).statusCode).toBe(200);fake.data.get('employees/ADMIN').role=UserRole.Employee;expect((await call('act-makeup-request',cmd)).statusCode).toBe(403);
});
it('B4a completes a legacy start date when a full overnight correction is explicitly supplied',async()=>{
 fake.data.get('employees/SYNTH').role=UserRole.Employee;vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'SYNTH'} as any);
 const response=await call('submit-makeup-version',{operationId:'explicit-overnight',date:'2026-04-01',type:'下班',recordId:'C1',requestedClockOutAt:'2026-04-02T06:00:00+08:00',reason:'合成完整跨夜時間'});expect(response.statusCode).toBe(200);const r=JSON.parse(response.body);
 vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'ADMIN'} as any);
 expect((await call('act-makeup-request',{requestId:r.id,mode:'approve',expectedRevision:1,operationId:'approve-overnight',reason:'合成核實完整日期'})).statusCode).toBe(200);
 const applied=fake.data.get('clockRecords/C1');expect(Date.parse(applied.clockInAt)).toBe(Date.parse('2026-04-01T09:00:00+08:00'));expect(applied.clockOutAt).toBe('2026-04-02T06:00:00+08:00');expect(applied.workReview).toBeNull();expect(hasAppliedMakeup(fake.data.get('makeupRequests/'+r.id),[applied],[...fake.data.entries()].filter(([k])=>k.startsWith('attendanceRevisions/')).map(([k,v])=>({...v,id:k.split('/')[1]})))).toBe(true);expect([...fake.data.entries()].find(([k])=>k.startsWith('attendanceRevisions/'))![1].before.clockOutTime).toBe('17:00');
});
describe('B4a capacity fix keeps retained link history within both read dimensions',()=>{
 const caseRow=(id:string)=>({id,empId:'SYNTH',revision:1,anchor:'card:C1',status:'open',observation:{window:{start:Date.parse('2026-04-01T09:00:00+08:00')/60000,end:Date.parse('2026-04-01T17:00:00+08:00')/60000}}});
 const draft={date:'2026-04-01',type:'下班',recordId:'C1',requestedClockOut:'18:00',reason:'合成關聯容量理由'};
 const login=()=>{fake.data.get('employees/SYNTH').role=UserRole.Employee;vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'SYNTH'} as any);};
 afterEach(()=>vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'ADMIN'} as any));
 it('request-side 101st link rejects but unlink/relink at100 reuse identity and retain quota',{timeout:60000},async()=>{
  login();const r=JSON.parse((await call('submit-makeup-version',{...draft,operationId:'request'})).body);
  const cmd=(c:string,extra:any={})=>({caseId:c,requestId:r.id,mode:'link',expectedRevision:1,expectedCaseRevision:1,expectedLinkRevision:0,operationId:c,reason:'合成關聯處理原因',...extra});
  for(let n=0;n<101;n++){fake.data.set('attendanceCases/C'+n,caseRow('C'+n));if(n<100)expect((await call('link-case-request',cmd('C'+n))).statusCode).toBe(200);}
  const before=JSON.stringify([...fake.data]);expect((await call('link-case-request',cmd('C100'))).statusCode).toBe(409);expect(JSON.stringify([...fake.data])).toBe(before);
  expect((await call('link-case-request',cmd('C0',{mode:'unlink',expectedLinkRevision:1,operationId:'unlink'}))).statusCode).toBe(200);
  expect((await call('link-case-request',cmd('C100'))).statusCode).toBe(409);
  const relink=cmd('C0',{expectedLinkRevision:2,operationId:'relink'});expect((await call('link-case-request',relink)).statusCode).toBe(200);expect((await call('link-case-request',relink)).statusCode).toBe(200);expect([...fake.data.keys()].filter(k=>k.startsWith('caseRequestLinks/'))).toHaveLength(100);
 });
 it('resubmit at full case capacity rejects atomically and replay at capacity costs no new slot',{timeout:60000},async()=>{
  login();fake.data.set('attendanceCases/C',caseRow('C'));let first:any;
  for(let n=0;n<100;n++){const result=await call('submit-makeup-version',{...draft,operationId:'create-'+n,caseId:'C',expectedCaseRevision:1});expect(result.statusCode).toBe(200);if(!n)first=JSON.parse(result.body);}
  expect((await call('submit-makeup-version',{...draft,operationId:'create-0',caseId:'C',expectedCaseRevision:1})).statusCode).toBe(200);
  const cancel=await call('act-makeup-request',{requestId:first.id,expectedRevision:1,mode:'cancel',operationId:'cancel',reason:'合成取消後重送'});expect(cancel.statusCode).toBe(200);const before=JSON.stringify([...fake.data]);
  expect((await call('act-makeup-request',{requestId:first.id,expectedRevision:2,mode:'resubmit',operationId:'resubmit',reason:'合成新版本理由',patch:draft})).statusCode).toBe(409);expect(JSON.stringify([...fake.data])).toBe(before);expect((await call('get-case-request-links',{caseId:'C'})).statusCode).toBe(200);
 });
});

describe('B4b private attachments; fake bytes/scanner only, no production adapter',()=>{
 const login=(uid='SYNTH')=>{fake.data.get('employees/SYNTH').role=UserRole.Employee;vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid} as any);};
 const draft=async()=>{login();const r=await call('create-makeup-attachment-draft',{date:'2026-04-01',operationId:'draft-one'});expect(r.statusCode,r.body).toBe(200);return JSON.parse(r.body);};
 const upload=(d:any,extra:any={})=>call('upload-makeup-attachment',{draftId:d.id,expectedDraftRevision:d.revision,operationId:'upload-one',name:'synthetic.pdf',mime:'application/pdf',contentBase64:syntheticPdf,...extra});
 const submit=(d:any,extra:any={})=>call('submit-makeup-version',{date:d.date,type:'下班',requestedClockOut:'18:00',recordId:'C1',reason:'合成附件申請理由',operationId:'submit-with-attachment',attachmentDraftId:d.id,expectedAttachmentDraftRevision:fake.data.get('makeupAttachmentDrafts/'+d.id).revision,...extra});
 it('default runtime/policy unavailable blocks capabilities, uploads and new submission without treating missing as optional',async()=>{login();vi.mocked(getMakeupAttachmentRuntime).mockReturnValue({mode:'disabled',policy:null});const c=JSON.parse((await call('get-makeup-attachment-capability')).body);expect(c.enabled).toBe(false);expect(c.policy).toBeNull();expect((await call('create-makeup-attachment-draft',{date:month+'-01',operationId:'draft'})).statusCode).toBe(503);expect((await call('submit-makeup-version',{date:month+'-01',type:'上班',requestedClockIn:'09:00',reason:'合成未核附件政策',operationId:'no-policy'})).statusCode).toBe(503);expect([...fake.data.keys()].some(k=>k.startsWith('makeupAttachment')||k.startsWith('makeupRequests/'))).toBe(false);});
 it('upload uses server hash/sniff/scanner, stable operation and no public storage key in response',async()=>{const d=await draft(),r=await upload(d);expect(r.statusCode,r.body).toBe(200);const m=JSON.parse(r.body);expect(m).toMatchObject({status:'ready',uploadComplete:true,mime:'application/pdf',revision:2,scan:{verdict:'clean'}});expect(m.sha256).toHaveLength(64);expect(m.storageKey).toBeUndefined();expect(m.url).toBeUndefined();expect((await upload(d)).statusCode).toBe(200);expect(attachmentFixture.writes).toBe(1);expect([...fake.data.keys()].filter(k=>k.startsWith('makeupAttachments/'))).toHaveLength(1);expect((await upload(d,{contentBase64:Buffer.from('%PDF-1.4\nchanged\n%%EOF').toString('base64')})).statusCode).toBe(409);});
 it.each([{mime:'image/png'},{name:'../private.pdf'},{storageKey:'other/request'},{sha256:'fake'},{scan:{verdict:'clean'}},{contentBase64:Buffer.from('<script>bad</script>').toString('base64')},{contentBase64:'https://private.invalid/file'},{name:'executable.exe'},{contentBase64:Buffer.from('%PDF-1.4\n'+'x'.repeat(1100)+'%%EOF').toString('base64')}])('rejects untrusted content/metadata %j',async extra=>{const d=await draft();expect((await upload(d,extra)).statusCode).toBe(400);expect(attachmentFixture.writes).toBe(0);});
 it('blocked scan and missing scanner cannot become submission evidence',async()=>{const d=await draft();attachmentFixture.setVerdict('blocked');const m=JSON.parse((await upload(d)).body);expect(m.status).toBe('rejected');expect((await submit(d)).statusCode).toBe(409);attachmentFixture.runtime.scanner=undefined;expect((await upload(d,{operationId:'missing-scanner'})).statusCode).toBe(503);expect([...fake.data.keys()].some(k=>k.startsWith('makeupRequests/'))).toBe(false);});
 it('storage/scanner failure is retryable with same ID but never dummy clean',async()=>{const d=await draft();attachmentFixture.setVerdict('error');expect(JSON.parse((await upload(d)).body).status).toBe('upload-failed');expect((await submit(d)).statusCode).toBe(409);attachmentFixture.setVerdict('clean');expect(JSON.parse((await upload(d)).body).status).toBe('ready');expect(attachmentFixture.writes).toBe(1);});
 it('binds clean files atomically and cannot cross-reference, withdraw submitted, or mutate approved evidence',async()=>{const d=await draft(),m=JSON.parse((await upload(d)).body);const out=await submit(d);expect(out.statusCode,out.body).toBe(200);const r=JSON.parse(out.body);expect(r.attachments).toHaveLength(1);expect(fake.data.get('makeupAttachments/'+m.id).requestId).toBe(r.id);expect((await call('withdraw-makeup-attachment',{attachmentId:m.id,expectedRevision:3,expectedDraftRevision:3,operationId:'remove',reason:'合成撤除'})).statusCode).toBe(409);expect((await submit(d,{operationId:'cross-reference'})).statusCode).toBe(409);login('ADMIN');expect((await call('act-makeup-request',{requestId:r.id,expectedRevision:1,mode:'approve',operationId:'approval',reason:'合成核准來源'})).statusCode).toBe(200);expect(fake.data.get('makeupAttachments/'+m.id).requestId).toBe(r.id);});
 it('draft withdrawal preserves bytes and append history and requires owner/version/reason',async()=>{const d=await draft(),m=JSON.parse((await upload(d)).body);const cmd={attachmentId:m.id,expectedRevision:m.revision,expectedDraftRevision:2,operationId:'withdraw',reason:'合成誤選附件撤除'};login('ADMIN');expect((await call('withdraw-makeup-attachment',cmd)).statusCode).toBe(403);login();expect((await call('withdraw-makeup-attachment',{...cmd,expectedRevision:0})).statusCode).toBe(409);expect((await call('withdraw-makeup-attachment',cmd)).statusCode).toBe(200);expect((await call('withdraw-makeup-attachment',cmd)).statusCode).toBe(200);expect(attachmentFixture.objects.size).toBe(1);expect([...fake.data.keys()].filter(k=>k.startsWith('makeupAttachmentEvents/'))).toHaveLength(3);});
 it('required policy/count/stale draft cannot silently submit empty or incomplete files',async()=>{const d=await draft();attachmentFixture.runtime.policy!.required=true;expect((await submit(d)).statusCode).toBe(409);await upload(d);expect((await submit(d,{expectedAttachmentDraftRevision:1})).statusCode).toBe(409);expect((await upload({...d,revision:2},{operationId:'second'})).statusCode).toBe(200);expect((await upload({...d,revision:3},{operationId:'third'})).statusCode).toBe(409);fake.data.get('makeupAttachments/'+JSON.parse((await upload(d)).body).id).uploadComplete=false;expect((await submit(d)).statusCode).toBe(409);});
 it('private download grants are principal-bound, one-use, short-lived and recheck current scope',async()=>{const d=await draft(),m=JSON.parse((await upload(d)).body);login('ADMIN');expect((await call('issue-makeup-attachment-access',{attachmentId:m.id})).statusCode).toBe(403);login();const grant=JSON.parse((await call('issue-makeup-attachment-access',{attachmentId:m.id})).body);login('ADMIN');expect((await call('download-makeup-attachment',grant)).statusCode).toBe(403);login();const bytes=await call('download-makeup-attachment',grant);expect(bytes.statusCode).toBe(200);expect(bytes.headers['Cache-Control']).toBe('no-store');expect(bytes.headers['X-Content-Type-Options']).toBe('nosniff');expect(JSON.parse(bytes.body).contentBase64).toBe(syntheticPdf);expect((await call('download-makeup-attachment',grant)).statusCode).toBe(403);const expired=JSON.parse((await call('issue-makeup-attachment-access',{attachmentId:m.id})).body);vi.useFakeTimers();vi.setSystemTime(Date.now()+61000);expect((await call('download-makeup-attachment',expired)).statusCode).toBe(403);});
 it('submitted download checks employee scope again after grant and verifies stored bytes',async()=>{const d=await draft(),m=JSON.parse((await upload(d)).body);await submit(d);login('ADMIN');const grant=JSON.parse((await call('issue-makeup-attachment-access',{attachmentId:m.id})).body);fake.data.get('employees/ADMIN').role=UserRole.Employee;expect((await call('download-makeup-attachment',grant)).statusCode).toBe(403);login();const ownGrant=JSON.parse((await call('issue-makeup-attachment-access',{attachmentId:m.id})).body);for(const k of attachmentFixture.objects.keys())attachmentFixture.objects.set(k,Buffer.from('tampered'));expect((await call('download-makeup-attachment',ownGrant)).statusCode).toBe(409);});
 it('month lock blocks draft/upload/withdraw and attachment binding without partial metadata writes',async()=>{const d=await draft(),m=JSON.parse((await upload(d)).body);lock();const before=JSON.stringify([...fake.data]);expect((await upload({...d,revision:2},{operationId:'locked-upload'})).statusCode).toBe(423);expect((await call('withdraw-makeup-attachment',{attachmentId:m.id,expectedRevision:2,expectedDraftRevision:2,operationId:'locked-withdraw',reason:'合成鎖月不得撤除'})).statusCode).toBe(423);expect((await submit(d)).statusCode).toBe(423);expect(JSON.stringify([...fake.data])).toBe(before);});
});
it('B4b legacy submission cannot bypass required attachment policy or attach unchecked references',async()=>{
 attachmentFixture.runtime.policy!.required=true;const input={date:'2026-04-01',type:'下班',reason:'合成舊入口不得略過',requestedClockOut:'18:00'};
 expect((await call('submit-makeup-request',input)).statusCode).toBe(409);expect((await call('submit-makeup-request',{...input,attachmentDraftId:'foreign'})).statusCode).toBe(409);expect([...fake.data.keys()].some(k=>k.startsWith('makeupRequests/'))).toBe(false);
});
it('B4b rejects client evidence, policy drift and tampered scan linkage before applying a card',async()=>{
 fake.data.get('employees/SYNTH').role=UserRole.Employee;vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'SYNTH'} as any);
 const input={date:'2026-04-01',type:'下班',requestedClockOut:'18:00',recordId:'C1',reason:'合成政策證據檢查',operationId:'submit-proof'};
 expect((await call('submit-makeup-version',{...input,attachments:[]})).statusCode).toBe(400);
 const d=JSON.parse((await call('create-makeup-attachment-draft',{date:input.date,operationId:'proof-draft'})).body);
 const m=JSON.parse((await call('upload-makeup-attachment',{draftId:d.id,expectedDraftRevision:1,operationId:'proof-upload',name:'synthetic.pdf',mime:'application/pdf',contentBase64:syntheticPdf})).body);
 attachmentFixture.runtime.policy!.version='synthetic-new-policy';expect((await call('submit-makeup-version',{...input,attachmentDraftId:d.id,expectedAttachmentDraftRevision:2})).statusCode).toBe(409);
 attachmentFixture.runtime.policy!.version='synthetic-policy-v1';const response=await call('submit-makeup-version',{...input,attachmentDraftId:d.id,expectedAttachmentDraftRevision:2});expect(response.statusCode).toBe(200);const r=JSON.parse(response.body);fake.data.get('makeupAttachments/'+m.id).scan.hash='tampered';vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'ADMIN'} as any);const before=JSON.stringify(fake.data.get('clockRecords/C1'));
 expect((await call('act-makeup-request',{requestId:r.id,expectedRevision:1,mode:'approve',operationId:'tampered-proof',reason:'合成核對附件來源'})).statusCode).toBe(409);expect(JSON.stringify(fake.data.get('clockRecords/C1'))).toBe(before);expect(fake.data.get('makeupRequests/'+r.id).status).toBe('待審核');
});
it('B4b preserves existing non-ASCII employee IDs and separates draft operation key tuples',async()=>{
 const uid='合成人員:甲';fake.data.set('employees/'+uid,{id:uid,name:'合成人員',role:UserRole.Employee});vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid} as any);
 expect((await call('get-makeup-attachment-capability')).statusCode).toBe(200);const one=await call('create-makeup-attachment-draft',{date:'2026-04-01',operationId:'乙'});expect(one.statusCode).toBe(200);
 const uid2='合成人員';fake.data.set('employees/'+uid2,{id:uid2,name:'合成人員2',role:UserRole.Employee});vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:uid2} as any);const two=await call('create-makeup-attachment-draft',{date:'2026-04-01',operationId:'甲:乙'});expect(two.statusCode).toBe(200);expect(JSON.parse(one.body).id).not.toBe(JSON.parse(two.body).id);
});

describe('B4c independent explanations and linked backdated leave',()=>{
 const login=(uid='SYNTH')=>{fake.data.get('employees/SYNTH').role=UserRole.Employee;vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid} as any);};
 const start=async()=>{login('ADMIN');expect((await call('scan-attendance-cases',{empId:'SYNTH',yearMonth:month})).statusCode).toBe(200);const c=[...fake.data.entries()].find(([k,v])=>k.startsWith('attendanceCases/')&&v.type==='unscheduled-card'&&v.anchor==='card:C1')![1];login();return c.id;};
 const state=async(id:string)=>JSON.parse((await call('get-case-explanation-workflow',{caseId:id})).body);
 const cmd=async(id:string,extra:any={})=>{const s=await state(id);return {caseId:id,expectedCaseRevision:s.caseRevision,expectedEvidenceVersion:s.evidenceVersion,operationId:randomUUID(),reason:'合成異常來源核實',...extra};};
 const explain=async(id:string,extra:any={})=>{const response=await call('submit-anomaly-explanation',await cmd(id,{text:'合成當日外出原因待核實',...extra}));expect(response.statusCode,response.body).toBe(200);return JSON.parse(response.body);};
 const leaveInput={leaveType:LeaveType.Personal,startDate:'2026-04-01T13:00:00+08:00',endDate:'2026-04-01T17:00:00+08:00'};
 afterEach(()=>vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'ADMIN'} as any));
 it('owner→request-info→new version→accept→leave approval/allocation retains history and overlap blocker without paying from text',async()=>{
  const id=await start(),raw=JSON.stringify(fake.data.get('clockRecords/C1')),e=await explain(id);login('ADMIN');const returned=await call('act-anomaly-explanation',await cmd(id,{explanationId:e.id,expectedRevision:1,mode:'request-info'}));expect(returned.statusCode,returned.body).toBe(200);login();const nextResponse=await call('act-anomaly-explanation',await cmd(id,{explanationId:e.id,expectedRevision:2,mode:'resubmit',text:'合成補充後說明仍待核實'}));expect(nextResponse.statusCode,nextResponse.body).toBe(200);const next=JSON.parse(nextResponse.body);expect(next.id).not.toBe(e.id);expect(fake.data.get('anomalyExplanations/'+e.id)).toMatchObject({status:'superseded',text:e.text});
  login('ADMIN');expect((await call('act-anomaly-explanation',await cmd(id,{explanationId:next.id,expectedRevision:1,mode:'accept'}))).statusCode).toBe(200);expect(JSON.stringify(fake.data.get('clockRecords/C1'))).toBe(raw);expect([...fake.data.keys()].some(k=>k.startsWith('leaveRequests/'))).toBe(false);expect(fake.data.get('attendanceCases/'+id).status).not.toBe('resolved');
  login();const created=await call('submit-case-leave',await cmd(id,{...leaveInput,explanationId:next.id}));expect(created.statusCode,created.body).toBe(200);const r=JSON.parse(created.body);expect(r.reviewIssues).toContain('clock-leave-overlap');login('ADMIN');const approved=await call('review-case-leave',await cmd(id,{leaveRequestId:r.id,expectedRevision:1,mode:'approve'}));expect(approved.statusCode,approved.body).toBe(200);expect(JSON.parse(approved.body)).toMatchObject({status:LeaveStatus.Approved,policyStatus:'needs-review',applicationEvidence:{requiresPayrollAllocation:true}});
  expect((await call('review-leave-allocation',{requestId:r.id,expectedRevision:2,allocations:[{date:'2026-04-01',from:'13:00',to:'17:00',minutes:240}]})).statusCode).toBe(200);
  const cases=[...fake.data.entries()].filter(([k])=>k.startsWith('attendanceCases/')).map(([,v])=>v);expect(cases.some(c=>c.type==='work-leave-overlap'&&c.observation.outcome==='finding'&&c.status!=='resolved')).toBe(true);expect([...fake.data.keys()].filter(k=>k.startsWith('leaveRevisions/'))).toHaveLength(2);expect([...fake.data.entries()].filter(([k])=>k.startsWith('attendanceCaseOutbox/')).every(([,v])=>v.channel==='sandbox'&&v.state==='held')).toBe(true);expect([...fake.data.keys()].some(k=>k.startsWith('notifications/'))).toBe(false);expect(JSON.parse((await call('get-employee-salary',{empId:'SYNTH',yearMonth:month})).body).preflight.status).toBe('BLOCKED');
 });
 it('B4c fix: stale adopted source after rescan cannot support new leave, and pending approval rechecks it',async()=>{const id=await start(),e=await explain(id);login('ADMIN');await call('act-anomaly-explanation',await cmd(id,{explanationId:e.id,expectedRevision:1,mode:'accept'}));login();const good=await call('submit-case-leave',await cmd(id,{...leaveInput,explanationId:e.id}));expect(good.statusCode,good.body).toBe(200);fake.data.get('clockRecords/C1').clockOutTime='18:00';login('ADMIN');await call('scan-attendance-cases',{empId:'SYNTH',yearMonth:month});const before=JSON.stringify([...fake.data]);const r=JSON.parse(good.body);expect((await call('review-case-leave',await cmd(id,{leaveRequestId:r.id,expectedRevision:1,mode:'approve'}))).statusCode).toBe(409);login();expect((await call('submit-case-leave',await cmd(id,{...leaveInput,startDate:'2026-04-01T17:00:00+08:00',endDate:'2026-04-01T18:00:00+08:00',explanationId:e.id}))).statusCode).toBe(409);expect(JSON.stringify([...fake.data])).toBe(before);});
 it('B4c fix: unchanged source still rejects outside the adopted interval and missing adopted proof',async()=>{const id=await start(),e=await explain(id);login('ADMIN');await call('act-anomaly-explanation',await cmd(id,{explanationId:e.id,expectedRevision:1,mode:'accept'}));login();const before=JSON.stringify([...fake.data]);expect((await call('submit-case-leave',await cmd(id,{...leaveInput,startDate:'2026-04-01T08:00:00+08:00',endDate:'2026-04-01T10:00:00+08:00',explanationId:e.id}))).statusCode).toBe(409);expect(JSON.stringify([...fake.data])).toBe(before);delete fake.data.get('anomalyExplanations/'+e.id).acceptedSource;expect((await call('submit-case-leave',await cmd(id,{...leaveInput,explanationId:e.id}))).statusCode).toBe(409);});
 it('same operation replay preserves explanation/events/outbox; stale or self-accept rejects',async()=>{const id=await start(),command=await cmd(id,{text:'合成可重跑本人說明'}),first=await call('submit-anomaly-explanation',command);expect(first.statusCode).toBe(200);const before=JSON.stringify([...fake.data].filter(([k])=>!k.startsWith('payrollControl/')));expect((await call('submit-anomaly-explanation',command)).body).toBe(first.body);expect(JSON.stringify([...fake.data].filter(([k])=>!k.startsWith('payrollControl/')))).toBe(before);expect((await call('submit-anomaly-explanation',{...command,operationId:'stale'})).statusCode).toBe(409);const e=JSON.parse(first.body);expect((await call('act-anomaly-explanation',await cmd(id,{explanationId:e.id,expectedRevision:1,mode:'accept'}))).statusCode).toBe(403);expect((await call('submit-anomaly-explanation',await cmd(id,{text:'合成不得偽造證據',paidFraction:0}))).statusCode).toBe(400);});
 it('source change after explanation requires rescan/revision, not time-based acceptance',async()=>{const id=await start(),e=await explain(id);fake.data.get('clockRecords/C1').clockOutTime='18:00';login('ADMIN');expect((await call('act-anomaly-explanation',await cmd(id,{explanationId:e.id,expectedRevision:1,mode:'accept'}))).statusCode).toBe(409);expect(fake.data.get('anomalyExplanations/'+e.id).status).toBe('submitted');});
 it('pending explanations enter shared preflight and accepted cannot cancel or self-clear case',async()=>{const id=await start(),e=await explain(id);const salary=JSON.parse((await call('get-employee-salary',{empId:'SYNTH',yearMonth:month})).body);expect(salary.preflight.issues.some(i=>JSON.stringify(i).includes('anomalyExplanations'))).toBe(true);login('ADMIN');expect((await call('act-anomaly-explanation',await cmd(id,{explanationId:e.id,expectedRevision:1,mode:'accept'}))).statusCode).toBe(200);login();expect((await call('act-anomaly-explanation',await cmd(id,{explanationId:e.id,expectedRevision:2,mode:'cancel'}))).statusCode).toBe(409);expect(fake.data.get('attendanceCases/'+id).status).not.toBe('resolved');});
 it('invalid type/time, duplicate pending/approved period and legacy bypass are rejected',async()=>{const id=await start();for(const patch of [{leaveType:'unknown'},{startDate:'2026-04-01T13:00'},{endDate:'2026-04-01T12:00:00+08:00'}])expect((await call('submit-case-leave',await cmd(id,{...leaveInput,...patch}))).statusCode).toBe(400);const r=await call('submit-case-leave',await cmd(id,leaveInput));expect(r.statusCode,r.body).toBe(200);expect((await call('submit-case-leave',await cmd(id,leaveInput))).statusCode).toBe(409);expect((await call('submit-leave-request',{...leaveInput,reason:'合成舊入口不得重複'})).statusCode).toBe(409);login('ADMIN');expect((await call('approve-leave',{requestId:JSON.parse(r.body).id,status:LeaveStatus.Approved})).statusCode).toBe(409);});
 it('cross-month full window guards explanation and leave mutations with zero partial writes',async()=>{const id=await start();const c=fake.data.get('attendanceCases/'+id);c.observation.window={start:Date.parse('2026-04-30T22:00:00+08:00')/60000,end:Date.parse('2026-05-01T06:00:00+08:00')/60000};lock('2026-05');const before=JSON.stringify([...fake.data]);expect((await call('submit-anomaly-explanation',await cmd(id,{text:'合成跨月來源不可改'}))).statusCode).toBe(423);expect((await call('submit-case-leave',await cmd(id,{leaveType:LeaveType.Personal,startDate:'2026-04-30T23:00:00+08:00',endDate:'2026-05-01T02:00:00+08:00'}))).statusCode).toBe(423);expect(JSON.stringify([...fake.data])).toBe(before);});
 it('100 retained explanation links reject next create before any history/receipt mutation',async()=>{const id=await start();for(let n=0;n<100;n++)fake.data.set('caseExplanationLinks/L'+n,{id:'L'+n,caseId:id,sourceId:'old-'+n});const c=fake.data.get('attendanceCases/'+id),before=JSON.stringify([...fake.data]);const r=await call('submit-anomaly-explanation',{caseId:id,expectedCaseRevision:c.revision,expectedEvidenceVersion:c.observation.evidenceVersion,operationId:'capacity',reason:'合成容量上限不得部分寫入',text:'合成完整說明內容'});expect(r.statusCode).toBe(409);expect(JSON.stringify([...fake.data])).toBe(before);});
 it('foreign employee cannot read workflow or all-leave listing; no role widening',async()=>{const id=await start();fake.data.set('employees/OTHER',{id:'OTHER',role:UserRole.Employee});login('OTHER');expect((await call('get-case-explanation-workflow',{caseId:id})).statusCode).toBe(403);expect((await call('get-all-leave-requests')).statusCode).toBe(403);});
});
it('B4c accepts exactly100 real explanation submissions and preserves readable retained history at the limit',{timeout:60000},async()=>{
 fake.data.get('employees/SYNTH').role=UserRole.Employee;await call('scan-attendance-cases',{empId:'SYNTH',yearMonth:month});const first=[...fake.data.entries()].find(([k,v])=>k.startsWith('attendanceCases/')&&v.type==='unscheduled-card'&&v.anchor==='card:C1')![1];vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'SYNTH'} as any);
 const command=(n:number)=>{const c=fake.data.get('attendanceCases/'+first.id);return {caseId:c.id,expectedCaseRevision:c.revision,expectedEvidenceVersion:c.observation.evidenceVersion,operationId:'capacity-real-'+n,reason:'合成不同說明歷史',text:'合成第'+n+'個可核對說明'};};
 for(let n=0;n<100;n++)expect((await call('submit-anomaly-explanation',command(n))).statusCode).toBe(200);const before=JSON.stringify([...fake.data]);expect((await call('submit-anomaly-explanation',command(100))).statusCode).toBe(409);expect(JSON.stringify([...fake.data])).toBe(before);const result=await call('get-case-explanation-workflow',{caseId:first.id});expect(result.statusCode).toBe(200);expect(JSON.parse(result.body).explanations).toHaveLength(100);
});

describe('B4d leave lifecycle and subject-bound private attachments',()=>{
 const login=(uid='SYNTH')=>{fake.data.get('employees/SYNTH').role=UserRole.Employee;vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid} as any);};
 const window={leaveType:LeaveType.Personal,startDate:'2026-04-01T13:00:00+08:00',endDate:'2026-04-01T14:00:00+08:00'};
 const start=async()=>{login('ADMIN');await call('scan-attendance-cases',{empId:'SYNTH',yearMonth:month});const c=[...fake.data.entries()].find(([k,v])=>k.startsWith('attendanceCases/')&&v.anchor==='card:C1')![1];login();return c.id;};
 const submit=async(caseId:string,extra:any={})=>{const c=fake.data.get('attendanceCases/'+caseId);return call('submit-case-leave',{caseId,expectedCaseRevision:c.revision,expectedEvidenceVersion:c.observation.evidenceVersion,operationId:randomUUID(),reason:'合成假單來源測試',...window,...extra});};
 const command=async(requestId:string,mode:string,extra:any={})=>{const w=JSON.parse((await call('get-leave-workflow',{requestId})).body);return {requestId,caseId:w.request.caseId||'leave:'+requestId,expectedRevision:w.request.revision||0,sourceVersion:w.sourceVersion,expectedCaseRevision:w.caseRevision,expectedEvidenceVersion:w.caseEvidenceVersion,operationId:randomUUID(),mode,reason:'合成版本操作完整原因',...extra};};
 const policy=()=>fake.data.set('leavePolicyVersions/P',{version:'synthetic-reserve-v1',status:'approved',approvedBy:'ADMIN',approvedAt:'2026-01-01T00:00:00Z',effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',employeeIds:['SYNTH'],leaveType:LeaveType.Personal,backdatedMaxDays:1000,quota:{periodStart:'2026-01-01',periodEnd:'2026-12-31',minutes:60,basis:'requested-span-minutes',reservePending:true}});
 it('request-info→new immutable version→approve preserves raw evidence, links and revisions',async()=>{const id=await start(),r=JSON.parse((await submit(id)).body),raw=JSON.stringify(fake.data.get('clockRecords/C1'));login('ADMIN');expect((await call('act-leave-version',await command(r.id,'request-info'))).statusCode).toBe(200);login();const res=await call('act-leave-version',await command(r.id,'resubmit',window));expect(res.statusCode,res.body).toBe(200);const next=JSON.parse(res.body);expect(next.id).not.toBe(r.id);expect(fake.data.get('leaveRequests/'+r.id)).toMatchObject({status:LeaveStatus.Superseded,supersededBy:next.id});expect(next).toMatchObject({status:LeaveStatus.Pending,supersedesId:r.id,leavePolicyAssessment:{status:'needs-review'}});login('ADMIN');expect((await call('act-leave-version',await command(next.id,'approve'))).statusCode).toBe(200);login();expect((await call('act-leave-version',await command(next.id,'cancel'))).statusCode).toBe(409);expect(JSON.stringify(fake.data.get('clockRecords/C1'))).toBe(raw);expect([...fake.data.keys()].filter(k=>k.startsWith('caseLeaveLinks/'))).toHaveLength(2);expect(fake.data.get('attendanceCases/'+id).status).not.toBe('resolved');});
 it('cancel/replay releases only explicit reservation; unknown policy does not invent a balance',async()=>{const id=await start();policy();const r=JSON.parse((await submit(id)).body);expect(r.leavePolicyAssessment).toMatchObject({status:'confirmed-reservation-only',reservedMinutes:60});expect((await submit(id,{startDate:'2026-04-01T15:00:00+08:00',endDate:'2026-04-01T16:00:00+08:00'})).statusCode).toBe(409);const cmd=await command(r.id,'cancel');expect((await call('act-leave-version',cmd)).statusCode).toBe(200);const count=[...fake.data.keys()].length;expect((await call('act-leave-version',cmd)).statusCode).toBe(200);expect([...fake.data.keys()]).toHaveLength(count);expect((await submit(id,{startDate:'2026-04-01T15:00:00+08:00',endDate:'2026-04-01T16:00:00+08:00'})).statusCode).toBe(200);});
 it('unapproved policy remains unknown; approved deadline is enforced without guessing',async()=>{const id=await start();policy();fake.data.get('leavePolicyVersions/P').status='draft';const r=JSON.parse((await submit(id)).body);expect(r.leavePolicyAssessment.status).toBe('needs-review');expect(r.leavePolicyAssessment.reservedMinutes).toBeUndefined();await call('act-leave-version',await command(r.id,'cancel'));fake.data.get('leavePolicyVersions/P').status='approved';fake.data.get('leavePolicyVersions/P').backdatedMaxDays=0;expect((await submit(id)).statusCode).toBe(409);});
 it('cross-month lock, stale source, own approval and foreign ownership reject without partial mutation',async()=>{const id=await start(),r=JSON.parse((await submit(id)).body),cmd=await command(r.id,'cancel');expect((await call('act-leave-version',await command(r.id,'approve'))).statusCode).toBe(403);fake.data.get('leaveRequests/'+r.id).reason='changed';expect((await call('act-leave-version',cmd)).statusCode).toBe(409);lock(month);const before=JSON.stringify([...fake.data]);expect((await call('act-leave-version',await command(r.id,'cancel'))).statusCode).toBe(423);expect(JSON.stringify([...fake.data])).toBe(before);fake.data.set('employees/OTHER',{id:'OTHER',role:UserRole.Employee});login('OTHER');expect((await call('get-leave-workflow',{requestId:r.id})).statusCode).toBe(403);});
 it('legacy pending leave can return/cancel/resubmit without rewriting original history',async()=>{login();fake.data.set('leaveRequests/LEG',{id:'LEG',empId:'SYNTH',name:'合成',...window,hours:1,status:LeaveStatus.Pending,reason:'舊版來源'});login('ADMIN');expect((await call('act-leave-version',await command('LEG','return'))).statusCode).toBe(200);login();expect((await call('act-leave-version',await command('LEG','cancel'))).statusCode).toBe(200);const res=await call('act-leave-version',await command('LEG','resubmit',window));expect(res.statusCode,res.body).toBe(200);expect(JSON.parse(res.body).schemaVersion).toBe('leave-version-v1');expect(fake.data.get('leaveRequests/LEG').reason).toBe('舊版來源');});
 it('required leave attachments cannot reuse makeup namespace; valid new submission retains explicit subject',async()=>{const id=await start();attachmentFixture.runtime.policy!.required=true;const md=JSON.parse((await call('create-makeup-attachment-draft',{date:'2026-04-01',operationId:'same'})).body);expect((await submit(id,{attachmentDraftId:md.id,expectedAttachmentDraftRevision:1})).statusCode).toBe(404);const d=JSON.parse((await call('create-leave-attachment-draft',{date:'2026-04-01',operationId:'same'})).body);expect(d.id).not.toBe(md.id);const up=await call('upload-leave-attachment',{draftId:d.id,expectedDraftRevision:1,operationId:'up',name:'synthetic.pdf',mime:'application/pdf',contentBase64:syntheticPdf});expect(up.statusCode,up.body).toBe(200);const m=JSON.parse(up.body);expect(m.subjectType).toBe('leave');const result=await submit(id,{attachmentDraftId:d.id,expectedAttachmentDraftRevision:2});expect(result.statusCode,result.body).toBe(200);const r=JSON.parse(result.body);expect(fake.data.get('leaveAttachments/'+m.id)).toMatchObject({subjectType:'leave',subjectId:r.id,requestId:r.id});expect((await call('list-makeup-attachments',{makeupRequestId:r.id})).statusCode).toBe(404);expect((await call('withdraw-leave-attachment',{attachmentId:m.id,expectedRevision:3,expectedDraftRevision:3,operationId:'remove',reason:'不應刪除已提交附件'})).statusCode).toBe(409);});
 it('failed scan / disabled production leave runtime rejects submission with zero writes',async()=>{const id=await start();vi.mocked(getLeaveAttachmentRuntime).mockReturnValue({mode:'disabled',policy:null});const before=JSON.stringify([...fake.data]);expect((await submit(id)).statusCode).toBe(503);expect(JSON.stringify([...fake.data])).toBe(before);expect((await call('create-leave-attachment-draft',{date:'2026-04-01',operationId:'prod-disabled'})).statusCode).toBe(503);});
 it('resubmit with100 retained case links rejects before superseding original',async()=>{const id=await start(),r=JSON.parse((await submit(id)).body);await call('act-leave-version',await command(r.id,'cancel'));for(let i=0;i<99;i++)fake.data.set('caseLeaveLinks/old'+i,{caseId:id,sourceId:'old'+i});const before=JSON.stringify([...fake.data]);const c=fake.data.get('attendanceCases/'+id),source=fake.data.get('leaveRequests/'+r.id);const {evidenceHash}=await import('../netlify/functions/utils/attendanceCaseLifecycle');const result=await call('act-leave-version',{requestId:r.id,expectedRevision:source.revision,sourceVersion:evidenceHash(source),expectedCaseRevision:c.revision,expectedEvidenceVersion:c.observation.evidenceVersion,operationId:'capacity-resubmit',reason:'合成新版本容量核實',mode:'resubmit',...window});expect(result.statusCode).toBe(409);expect(JSON.stringify([...fake.data])).toBe(before);});
});
it('B4d legacy date without zone is interpreted as Taipei consistently for reservation and lock boundaries',async()=>{const {leaveTimestamp}=await import('../netlify/functions/utils/leavePolicy');expect(leaveTimestamp('2026-08-01T00:30')).toBe(Date.parse('2026-07-31T16:30:00Z'));expect(leaveTimestamp('2026-08-01T00:30:00+08:00')).toBe(leaveTimestamp('2026-08-01T00:30'));});
it('B4d approved policy effective dates cannot silently become unlimited outside the approved interval',async()=>{const {assessLeavePolicy}=await import('../netlify/functions/utils/leavePolicy');fake.data.set('leavePolicyVersions/P',{version:'approved-old',status:'approved',approvedBy:'ADMIN',approvedAt:'2026-01-01T00:00:00Z',leaveType:LeaveType.Personal,employeeIds:['SYNTH'],effectiveFrom:'2026-01-01',effectiveTo:'2026-03-31'});await expect(assessLeavePolicy(fake.db,{get:(r:any)=>r.get()},{empId:'SYNTH',leaveType:LeaveType.Personal,startDate:'2026-04-01T09:00:00+08:00',endDate:'2026-04-01T10:00:00+08:00'})).rejects.toMatchObject({statusCode:409});});
it('B4d resubmission cannot inherit a stale adopted explanation; explicit removal preserves old source history',async()=>{
 vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'ADMIN'} as any);fake.data.get('employees/SYNTH').role=UserRole.Employee;await call('scan-attendance-cases',{empId:'SYNTH',yearMonth:month});const first=[...fake.data.entries()].find(([k,v])=>k.startsWith('attendanceCases/')&&v.type==='unscheduled-card'&&v.anchor==='card:C1')![1];const cmd=()=>{const c=fake.data.get('attendanceCases/'+first.id);return {caseId:c.id,expectedCaseRevision:c.revision,expectedEvidenceVersion:c.observation.evidenceVersion,operationId:randomUUID(),reason:'合成採納來源版本核實'};};
 vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'SYNTH'} as any);const ex=JSON.parse((await call('submit-anomaly-explanation',{...cmd(),text:'合成原本已採納的說明'})).body);vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'ADMIN'} as any);await call('act-anomaly-explanation',{...cmd(),explanationId:ex.id,expectedRevision:1,mode:'accept'});vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'SYNTH'} as any);const input={leaveType:LeaveType.Personal,startDate:'2026-04-01T13:00:00+08:00',endDate:'2026-04-01T14:00:00+08:00'};const r=JSON.parse((await call('submit-case-leave',{...cmd(),...input,explanationId:ex.id})).body);fake.data.get('clockRecords/C1').clockOutTime='18:00';vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'ADMIN'} as any);await call('scan-attendance-cases',{empId:'SYNTH',yearMonth:month});
 const lifecycle=async(mode:string,extra:any={})=>{const w=JSON.parse((await call('get-leave-workflow',{requestId:r.id})).body);return {...cmd(),requestId:r.id,sourceVersion:w.sourceVersion,expectedRevision:w.request.revision,mode,...extra};};expect((await call('act-leave-version',await lifecycle('approve'))).statusCode).toBe(409);vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'SYNTH'} as any);expect((await call('act-leave-version',await lifecycle('cancel'))).statusCode).toBe(200);const before=JSON.stringify([...fake.data]);expect((await call('act-leave-version',await lifecycle('resubmit',input))).statusCode).toBe(409);expect(JSON.stringify([...fake.data])).toBe(before);const fresh=await call('act-leave-version',await lifecycle('resubmit',{...input,explanationId:null}));expect(fresh.statusCode,fresh.body).toBe(200);expect(fake.data.get('leaveRequests/'+r.id).explanationId).toBe(ex.id);expect(JSON.parse(fresh.body).explanationId).toBeNull();
});
it('B4d legacy new submission normalizes Taipei minutes, does not round span, and rejects known employment mismatch',async()=>{vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'SYNTH'} as any);fake.data.get('employees/SYNTH').role=UserRole.Employee;const input={leaveType:LeaveType.Personal,startDate:'2026-04-01T09:00',endDate:'2026-04-01T09:01',reason:'合成一分鐘來源'};const result=await call('submit-leave-request',input);expect(result.statusCode,result.body).toBe(200);const r=[...fake.data.entries()].find(([k])=>k.startsWith('leaveRequests/'))![1];expect(r).toMatchObject({hours:1/60,startDate:'2026-04-01T09:00+08:00',leavePolicyAssessment:{status:'needs-review'}});fake.data.get('employees/SYNTH').hireDate='2026-05-01';expect((await call('submit-leave-request',{...input,startDate:'2026-04-02T09:00',endDate:'2026-04-02T09:01'})).statusCode).toBe(409);fake.data.get('employees/SYNTH').hireDate='2026-04-01';expect((await call('submit-leave-request',{...input,startDate:'2026-03-31T16:01:00Z',endDate:'2026-03-31T16:02:00Z'})).statusCode).toBe(200);});
it('B4d legacy approval cannot bypass nonself review through an administrator own request',async()=>{vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'ADMIN'} as any);fake.data.set('leaveRequests/OWN',{empId:'ADMIN',leaveType:LeaveType.Personal,startDate:'2026-04-01T09:00:00+08:00',endDate:'2026-04-01T10:00:00+08:00',hours:1,status:LeaveStatus.Pending});expect((await call('approve-leave',{requestId:'OWN',status:LeaveStatus.Approved})).statusCode).toBe(403);expect(fake.data.get('leaveRequests/OWN').status).toBe(LeaveStatus.Pending);});

describe('B5a overtime workflow separates work, request, approval and statutory pay',()=>{
 const login=(uid='SYNTH')=>{fake.data.get('employees/SYNTH').role=UserRole.Employee;vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid} as any);};
 const p=()=>fake.data.set('overtimeWorkflowPolicies/SYNTH',{status:'approved',version:'synthetic-workflow-v1',reviewerIds:['ADMIN'],approvedBy:'ADMIN',approvedAt:'2026-01-01T00:00:00Z',effectiveFrom:'2026-01-01',effectiveTo:'2099-12-31'});
 const input={phase:'after',kind:'on-site',startDate:'2026-04-01T15:00:00+08:00',endDate:'2026-04-01T17:00:00+08:00',reason:'合成實際工作申請'};
 const submit=async(extra:any={})=>{login();return call('submit-overtime-request',{...input,operationId:randomUUID(),...extra});};
 const cmd=async(r:any,mode:string,extra:any={})=>{const {evidenceHash}=await import('../netlify/functions/utils/attendanceCaseLifecycle');const current=fake.data.get('overtimeRequests/'+r.id);return {requestId:r.id,expectedRevision:current.revision,sourceVersion:evidenceHash(current),mode,reason:'合成指定主管覆核',operationId:randomUUID(),...extra};};
 it('unknown policy never grants an administrator arbitrary review/read scope; actual work remains recorded',async()=>{const r=await submit();expect(r.statusCode,r.body).toBe(200);const request=JSON.parse(r.body);expect(request).toMatchObject({actualWorkMinutes:120,requestedMinutes:120,approvedMinutes:null,statutoryPayableMinutes:null,dayType:'unverified'});login('ADMIN');expect((await call('get-overtime-workflow',{empId:'SYNTH'})).statusCode).toBe(403);expect((await call('act-overtime-request',await cmd(request,'approve',{intervals:[input]}))).statusCode).toBe(403);expect(fake.data.get('clockRecords/C1').workIntervals).toEqual([{start:540,end:1020}]);});
 it('partial approval stays within request and confirmed work; approved-not-applied persists',async()=>{p();const r=JSON.parse((await submit()).body);login('ADMIN');const response=await call('act-overtime-request',await cmd(r,'partial-approve',{intervals:[{startDate:input.startDate,endDate:'2026-04-01T16:00:00+08:00'}]}));expect(response.statusCode,response.body).toBe(200);expect(JSON.parse(response.body)).toMatchObject({approvedMinutes:60,actualWorkMinutes:120,requestedMinutes:120,statutoryPayableMinutes:null});const cases=[...fake.data.entries()].filter(([k])=>k.startsWith('attendanceCases/')).map(([,v])=>v);expect(cases.some(c=>c.type==='approved-unapplied'&&c.anchor==='overtimeRequests:'+r.id&&c.status!=='resolved')).toBe(true);const salary=JSON.parse((await call('get-employee-salary',{empId:'SYNTH',yearMonth:month})).body);expect(salary.preflight.issues.some(i=>i.source==='overtimeRequests')).toBe(true);});
 it('reject/cancel never removes confirmed work or turns statutory payable into zero',async()=>{p();const raw=JSON.stringify(fake.data.get('clockRecords/C1'));const r=JSON.parse((await submit()).body);login('ADMIN');expect((await call('act-overtime-request',await cmd(r,'reject'))).statusCode).toBe(200);expect(fake.data.get('overtimeRequests/'+r.id).statutoryPayableMinutes).toBeNull();expect(JSON.stringify(fake.data.get('clockRecords/C1'))).toBe(raw);const next=JSON.parse((await submit()).body);const c=await cmd(next,'cancel');const one=await call('act-overtime-request',c),count=[...fake.data.keys()].length;expect(one.statusCode).toBe(200);expect((await call('act-overtime-request',c)).body).toBe(one.body);expect([...fake.data.keys()]).toHaveLength(count);expect(JSON.stringify(fake.data.get('clockRecords/C1'))).toBe(raw);});
 it('source change requires new version; supplement/resubmit preserves original and rejects self approval',async()=>{p();const r=JSON.parse((await submit()).body);expect((await call('act-overtime-request',await cmd(r,'approve',{intervals:[input]}))).statusCode).toBe(403);login('ADMIN');await call('act-overtime-request',await cmd(r,'request-info'));login();fake.data.get('clockRecords/C1').clockOutTime='18:00';const next=await call('act-overtime-request',await cmd(r,'resubmit',input));expect(next.statusCode,next.body).toBe(200);expect(JSON.parse(next.body).actualWorkMinutes).toBeNull();expect(fake.data.get('overtimeRequests/'+r.id).status).toBe('superseded');login('ADMIN');expect((await call('act-overtime-request',await cmd(JSON.parse(next.body),'approve',{intervals:[input]}))).statusCode).toBe(409);});
 it('overlapping requests and approval exceeding either requested or actual interval reject atomically',async()=>{p();const r=JSON.parse((await submit()).body);expect((await submit({startDate:'2026-04-01T16:00:00+08:00'})).statusCode).toBe(409);login('ADMIN');const before=JSON.stringify([...fake.data]);expect((await call('act-overtime-request',await cmd(r,'approve',{intervals:[{startDate:input.startDate,endDate:'2026-04-01T18:00:00+08:00'}]}))).statusCode).toBe(409);expect(JSON.stringify([...fake.data])).toBe(before);});
 it('future plan preauthorization is not approved work or payable; future/past phase mismatch rejects',async()=>{p();const future={...input,phase:'before',startDate:'2099-04-01T09:00:00+08:00',endDate:'2099-04-01T10:00:00+08:00'};const created=await submit(future);expect(created.statusCode,created.body).toBe(200);const r=JSON.parse(created.body);login('ADMIN');const granted=await call('act-overtime-request',await cmd(r,'preauthorize',{intervals:[future]}));expect(granted.statusCode,granted.body).toBe(200);expect(JSON.parse(granted.body)).toMatchObject({status:'preauthorized',actualWorkMinutes:null,approvedMinutes:null,statutoryPayableMinutes:null});expect((await submit({...future,phase:'after'})).statusCode).toBe(409);});
 it('full cross-month period is locked; client work/pay evidence and foreign links are refused',async()=>{login();lock('2026-05');const before=JSON.stringify([...fake.data]);expect((await submit({startDate:'2026-04-30T22:00:00+08:00',endDate:'2026-05-01T02:00:00+08:00'})).statusCode).toBe(423);expect(JSON.stringify([...fake.data])).toBe(before);expect((await submit({statutoryPayableMinutes:0})).statusCode).toBe(400);fake.data.set('attendanceCases/FOREIGN',{empId:'OTHER',observation:{window:{start:0,end:999999999}}});expect((await submit({linkedCaseId:'FOREIGN'})).statusCode).toBe(409);});
 it('approved source drift is visible and 8h candidate trigger is idempotent, never classifies day/pay',async()=>{p();fake.data.set('clockRecords/C1',card('2026-04-01','09:00','19:00'));const r=JSON.parse((await submit()).body);login('ADMIN');expect((await call('act-overtime-request',await cmd(r,'approve',{intervals:[input]}))).statusCode).toBe(200);fake.data.get('clockRecords/C1').clockOutTime='20:00';const state=JSON.parse((await call('get-overtime-workflow',{empId:'SYNTH'})).body);expect(state.requests[0].sourceChanged).toBe(true);expect(state.requests[0].statutoryPayableMinutes).toBeNull();const first=await call('scan-overtime-candidates',{empId:'SYNTH',yearMonth:month});expect(first.statusCode,first.body).toBe(200);const n=[...fake.data.keys()].filter(k=>k.startsWith('attendanceCaseOutbox/')).length;expect((await call('scan-overtime-candidates',{empId:'SYNTH',yearMonth:month})).statusCode).toBe(200);expect([...fake.data.keys()].filter(k=>k.startsWith('attendanceCaseOutbox/'))).toHaveLength(n);expect([...fake.data.entries()].some(([k,v])=>k.startsWith('attendanceCases/')&&v.anchor==='overtime-candidate:2026-04-01'&&v.observation.payrollDecision==='none')).toBe(true);});
});
it('B5a cross-midnight source union deduplicates overlapping records across month boundaries',async()=>{vi.mocked(adminAuth.verifyIdToken).mockResolvedValue({uid:'SYNTH'} as any);fake.data.get('employees/SYNTH').role=UserRole.Employee;const r={...card('2026-04-30','22:00','06:00',false),clockInAt:'2026-04-30T22:00:00+08:00',clockOutAt:'2026-05-01T06:00:00+08:00',workIntervals:[{start:1320,end:1800}]};r.workReview={sourceKey:clockSourceKey(r),reviewedBy:'ADMIN',reviewedAt:review.reviewedAt};fake.data.set('clockRecords/C1',r);fake.data.set('clockRecords/C2',card('2026-05-01','01:00','03:00'));const response=await call('submit-overtime-request',{phase:'after',kind:'offsite',startDate:'2026-04-30T23:00:00+08:00',endDate:'2026-05-01T02:00:00+08:00',reason:'合成跨月去重工作',operationId:'cross-union'});expect(response.statusCode,response.body).toBe(200);expect(JSON.parse(response.body)).toMatchObject({actualWorkMinutes:180,requestedMinutes:180,approvedMinutes:null,statutoryPayableMinutes:null,dayType:'unverified'});expect(JSON.parse(response.body).actualSource.refs).toHaveLength(2);});
