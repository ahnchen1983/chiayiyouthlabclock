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
        async get(){const docs=[...data.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===path.split('/').length+1).map(snapshot).filter(d=>filters.every(([f,op,v])=>op==='=='?d.data()[f]===v:op==='>='?d.data()[f]>=v:op==='<='?d.data()[f]<=v:false)).slice(0,limit);return {docs,empty:!docs.length,size:docs.length};}
    });
    const db:any={collection,async runTransaction(fn:any){const writes:any[]=[];let wrote=false;const tx:any={get:async(ref:any)=>{if(wrote)throw Error('read after write');return ref.get();}};for(const method of ['set','update','delete','create'])tx[method]=(ref:any,value:any)=>{wrote=true;writes.push([method,ref,value]);};const result=await fn(tx);for(const [method,ref,value]of writes){if(method==='create'){if(data.has(ref.path))throw Error('exists');await ref.set(value);}else await ref[method](value);}return result;}};
    return {data,db};
});
vi.mock('../netlify/functions/utils/firebaseAdmin',()=>({db:fake.db,adminAuth:{verifyIdToken:vi.fn().mockResolvedValue({uid:'ADMIN'}),createCustomToken:vi.fn().mockResolvedValue('synthetic-token')},adminMessaging:()=>({sendEachForMulticast:vi.fn().mockResolvedValue({responses:[]})})}));
import {handler} from '../netlify/functions/api';
const call=async(action:string,body:any={})=>await handler({httpMethod:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify({action,...body})} as any,{} as any) as any;
const lock=(m=month)=>fake.data.set(`monthLocks/${m}`,{yearMonth:m,lockedAt:review.reviewedAt,lockedBy:'ADMIN',lockedByName:'synthetic',employeeCount:1,totalAmount:1600});
beforeEach(()=>{fake.data.clear();fake.data.set('employees/ADMIN',{id:'ADMIN',name:'reviewer',role:UserRole.SuperAdmin,hireDate:'2020-01-01',accountKind:'system-account',hourlyRate:0,monthlySalary:0});fake.data.set(`employees/${employee.id}`,{...employee,status:'在職',hireDate:'2026-01-01'});fake.data.set('clockRecords/C1',card());});
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
 it('unrelated historical cards do not exhaust monthly snapshot capacity or get deleted',async()=>{for(let i=0;i<1000;i++)fake.data.set('clockRecords/OLD'+i,{...card('2025-01-01'),id:'OLD'+i,empId:i%2?'OTHER':'SYNTH',notes:'x'.repeat(800)});const response=await call('lock-month',{yearMonth:month});expect(response.statusCode).toBe(200);const run=fake.data.get('payrollRuns/'+JSON.parse(response.body).payrollRunId);expect(run.salaries[0].grossSalary).toBe(1600);expect(run.inputs.records.map(r=>r.id)).toEqual([card().id]);expect(fake.data.has('clockRecords/OLD999')).toBe(true);});
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
  const saved = fake.data.get('employees/SYNTH').payrollReview;
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
  const saved = fake.data.get('employees/ADMIN').payrollReview;
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
