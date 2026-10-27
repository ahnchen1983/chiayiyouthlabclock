import type {WithholdingResult} from '../../../utils/payroll/withholding';
import type { AttendanceCaseEvidence } from './attendanceCaseEvidence';
import type { AttendanceMonthEvidence } from './attendanceMonthEvidence';
import { hasAppliedMakeup } from './makeupEvidence';
import type { ClockRecord, LeaveRequest, ScheduleEvent, SalaryDetail, PayrollPreflight, PayrollPreflightIssue } from '../../../types';
import { clockInterval, shiftIntervals, validDate, hhmmMinutes } from '../../../utils/attendance';
import { calculateSalaryForEmployee } from './payroll';

// Remaining capabilities required before a month can be settled; remove each one
// when it is implemented. OT_COMP_REQUEST_MODEL closed 2026-10-25: overtime is paid
// from reviewed work via the C2b adapter and comp credits block per employee.
export const PREFLIGHT_GAPS = ['PAYROLL_ITEM_REQUIREMENTS', 'MANUAL_DIFF_APPROVAL', 'ATTENDANCE_CASE_WORKFLOW', 'PRODUCTION_RECONCILIATION'] as const;
export type RequestKind = 'terminationSettlementDrafts' | 'terminationAdjustmentCases' | 'compRequests' | 'compSettlementTasks' | 'overtimeRequests' | 'anomalyExplanations' | 'leaveRequests' | 'makeupRequests' | 'leaveOfAbsenceRequests' | 'shiftSwapRequests';
export type RequestEvidence = Record<string, any> & { id: string };
export type PendingSources = Record<RequestKind, RequestEvidence[]>;
const kinds: RequestKind[] = ['terminationSettlementDrafts','terminationAdjustmentCases','compRequests','compSettlementTasks','overtimeRequests','anomalyExplanations','leaveRequests', 'makeupRequests', 'leaveOfAbsenceRequests', 'shiftSwapRequests'];
const labels: Record<RequestKind, string> = {terminationSettlementDrafts:'人工離職薪資覆核',terminationAdjustmentCases:'離職歷史差額案件',compRequests:'補休申請／帳本',compSettlementTasks:'補休待結清',overtimeRequests:'加班申請',anomalyExplanations:'異常說明', leaveRequests: '假單/外勤', makeupRequests: '補卡', leaveOfAbsenceRequests: '留停', shiftSwapRequests: '換班' };
const finalStates: Record<RequestKind, string[]> = {terminationSettlementDrafts:[],terminationAdjustmentCases:[],compRequests:['approved','cancelled','rejected','superseded'],compSettlementTasks:[],overtimeRequests:['approved','partial-approved','rejected','cancelled','superseded'],
    anomalyExplanations:['accepted','rejected','cancelled','superseded'],
    leaveRequests: ['核准', '駁回', '已取消', '已取代'], makeupRequests: ['核准', '駁回', '已取消', '已取代'], leaveOfAbsenceRequests: ['核准', '駁回'],
    shiftSwapRequests: ['approved', 'rejected-by-peer', 'rejected-by-admin', 'cancelled'],
};
const pendingStates: Record<RequestKind, string[]> = {terminationSettlementDrafts:['draft','pending','approved','rejected'],terminationAdjustmentCases:['pending-review'],compRequests:['submitted','pending-policy','needs-info'],compSettlementTasks:['pending-payroll'],overtimeRequests:['submitted','needs-info','preauthorized'],
    anomalyExplanations:['submitted','needs-info'],
    leaveRequests: ['待審核','待補件'], makeupRequests: ['待審核', '待補件'], leaveOfAbsenceRequests: ['待審核'], shiftSwapRequests: ['awaiting-peer', 'awaiting-admin'],
};
const minute = (date: string) => Date.parse(date + 'T00:00:00+08:00') / 60000;
const instant = (value: unknown): number => {
    if (typeof value !== 'string' || !validDate(value.slice(0, 10))) return NaN;
    return value.length === 10 ? minute(value) : Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(value) ? value : value + '+08:00') / 60000;
};
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
export const requestEmployeeIds = (kind: RequestKind, r: RequestEvidence): string[] => kind === 'shiftSwapRequests' ? [r.fromEmpId, r.toEmpId] : [r.empId];

// Use the selected calendar month PLUS its actual overnight evidence. Merely
// being in an adjacent month is not sufficient to block an unrelated request.
export const requestAffectsMonth = (kind: RequestKind, r: RequestEvidence, month: string, employeeId: string, records: ClockRecord[], schedules: ScheduleEvent[]): boolean => {
    if(kind==='terminationSettlementDrafts'||kind==='terminationAdjustmentCases')return typeof r.month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)||r.month===month;
    const first = month + '-01';
    const next = new Date(first + 'T00:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1);
    const evidence = [{ start: minute(first), end: minute(next.toISOString().slice(0, 10)) }];
    for (const card of records.filter(x => x.empId === employeeId && x.date?.startsWith(month + '-'))) {
        const range = clockInterval(card);
        if (range) evidence.push({ start: minute(card.date) + range.start, end: minute(card.date) + range.end });
    }
    for (const day of schedules.filter(x => x.date?.startsWith(month + '-'))) {
        for (const range of shiftIntervals(day.shifts.filter(x => x.empId === employeeId)) || []) evidence.push({ start: minute(day.date) + range.start, end: minute(day.date) + range.end });
    }
    let ranges: { start: number; end: number }[];
    if (kind === 'shiftSwapRequests') ranges = [r.fromDate, r.toDate].map(date => ({ start: instant(date), end: instant(date) + 1440 }));
    else if (kind === 'makeupRequests') {
        // Keep the original date/record evidence even if the proposed correction moves it.
        ranges = [{ start: instant(r.date), end: instant(r.date) + 1440 }];
        for (const field of ['requestedClockInAt', 'requestedClockOutAt']) if (r[field]) ranges.push({ start: instant(r[field]), end: instant(r[field]) + 1 });
        const original = records.find(x => x.empId === employeeId && x.id === r.recordId);
        const proposed = clockInterval({ ...original, date: r.date, clockInTime: r.requestedClockIn || original?.clockInTime,
            clockOutTime: r.requestedClockOut || original?.clockOutTime,
            clockInAt: r.requestedClockInAt || original?.clockInAt, clockOutAt: r.requestedClockOutAt || original?.clockOutAt } as ClockRecord);
        if (proposed) ranges.push({ start: minute(r.date) + proposed.start, end: minute(r.date) + proposed.end });
        // Ambiguous legacy overnight is NOT approved work. Conservatively block
        // the possible next day until the correction has explicit dates.
        const legacyStart = hhmmMinutes(r.requestedClockIn || original?.clockInTime);
        const legacyEnd = hhmmMinutes(r.requestedClockOut || original?.clockOutTime);
        if (!proposed && legacyStart !== null && legacyEnd !== null && legacyEnd <= legacyStart)
            ranges.push({ start: minute(r.date), end: minute(r.date) + 2880 });
        for (const card of records.filter(x => x.empId === employeeId && x.id === r.recordId)) {
            const span = clockInterval(card);
            ranges.push({ start: minute(card.date), end: minute(card.date) + (span?.end || 1440) });
        }
    } else {
        const start = instant(r.startDate);
        const end = kind === 'leaveOfAbsenceRequests' && !r.endDate ? Infinity : instant(r.endDate) + (typeof r.endDate === 'string' && r.endDate.length === 10 ? 1440 : 0);
        ranges = [{ start, end }];
    }
    // Invalid evidence for this employee is unknown, never an empty period.
    if (ranges.some(x => !Number.isFinite(x.start) || Number.isNaN(x.end) || x.end <= x.start)) return true;
    return ranges.some(x => evidence.some(y => overlaps(x, y)));
};

export const pendingRequestIssues = (month: string, empId: string, sources: Partial<PendingSources>, records: ClockRecord[], schedules: ScheduleEvent[], revisions: any[] = []): PayrollPreflightIssue[] => {
    const issues: PayrollPreflightIssue[] = [];
    for (const kind of kinds) {
        if (!Array.isArray(sources[kind])) {
            issues.push({ code: 'SOURCE_UNAVAILABLE', severity: 'BLOCKED', source: kind, message: `${labels[kind]}預檢資料未載入` }); continue;
        }
        for (const request of sources[kind]!) {
            if (!request || !request.id || requestEmployeeIds(kind, request).some(id => typeof id !== 'string' || !id)) {
                issues.push({ code: 'SOURCE_UNAVAILABLE', severity: 'BLOCKED', source: kind, message: `${labels[kind]}存在無法識別歸屬的申請，須先核實` }); continue;
            }
            if (!requestEmployeeIds(kind, request).includes(empId)) continue;
            if (kind === 'makeupRequests' && request.status === '核准') {
                if (requestAffectsMonth(kind, request, month, empId, records, schedules) && !hasAppliedMakeup(request, records, revisions))
                    issues.push({ code: 'APPLICATION_UNVERIFIED', severity: 'NEEDS_REVIEW', source: kind, sourceId: request.id, message: `補卡 ${request.id} 核准套用證據或後續更正來源鏈待覆核` });
                continue;
            }
            if((kind==='overtimeRequests'||kind==='compRequests')&&['approved','partial-approved'].includes(request.status)&&requestAffectsMonth(kind,request,month,empId,records,schedules))issues.push({code:'APPLICATION_UNVERIFIED',severity:'NEEDS_REVIEW',source:kind,sourceId:request.id,message:'加班核准與依法應計／日別／薪資投影仍未核定；不得抹去已確認工作'});
            if (finalStates[kind].includes(request.status)) continue;
            if (!requestAffectsMonth(kind, request, month, empId, records, schedules)) continue;
            const pending = pendingStates[kind].includes(request.status);
            issues.push({ code: pending ? 'PENDING_REQUEST' : 'REQUEST_STATUS_UNKNOWN', severity: 'BLOCKED', source: kind, sourceId: request.id,
                message: `${labels[kind]} ${request.id} ${pending ? '待處理，不能月結' : '狀態不明，不能月結'}` });
        }
    }
    return issues;
};

// Terminal status is historical state, not current source clearance. This
// envelope is built by the server and is never accepted from API payloads.
export const attendanceCaseIssues = (month:string,empId:string,cases:any[]|undefined,evidence?:AttendanceCaseEvidence):PayrollPreflightIssue[] => {
    if (!Array.isArray(cases) || cases.some(c=>!c || typeof c.empId!=='string' || !c.empId || c.empId.length>150 || c.empId.includes('/')) || evidence?.inventory==='missing')
        return [{code:'SOURCE_UNAVAILABLE',severity:'BLOCKED',source:'attendanceCases',message:'出勤案件來源清冊未完整載入'}];
    const start=Date.parse(month+'-01T00:00:00+08:00')/60000;
    const next=new Date(month+'-01T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);
    const end=Date.parse(next.toISOString().slice(0,10)+'T00:00:00+08:00')/60000;
    const issues:PayrollPreflightIssue[]=[];
    for(const c of cases){
        if(c.empId!==empId)continue;
        const w=c.observation?.window;
        const validWindow=w&&Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.end>w.start;
        if(!['resolved','cancelled'].includes(c.status)){
            if(validWindow&&!(w.start<end&&w.end>start))continue;
            issues.push({code:'CASE_UNRESOLVED',severity:'NEEDS_REVIEW',source:'attendanceCases',...(typeof c.id==='string'?{sourceId:c.id}:{}),message:'出勤案件尚未完成覆核'});continue;
        }
        const matches=evidence?.assessments?.filter(a=>a.caseId===c.id)||[];
        const a=matches.length===1?matches[0]:undefined;
        const current=validWindow&&typeof c.id==='string'&&!!c.id&&cases.filter(other=>other.id===c.id).length===1&&
            Number.isInteger(c.revision)&&c.revision>0&&typeof c.observation?.evidenceVersion==='string'&&!!c.observation.evidenceVersion&&
            evidence?.inventory==='loaded'&&evidence.empId===empId&&evidence.month===month&&a?.status==='current-clear'&&
            a.caseRevision===c.revision&&a.storedEvidenceVersion===c.observation.evidenceVersion&&a.currentEvidenceVersion===c.observation.evidenceVersion&&['relevant','unrelated'].includes(a.scope);
        if(current&&a?.scope==='unrelated')continue;
        if(!current)issues.push({code:'APPLICATION_UNVERIFIED',severity:'NEEDS_REVIEW',source:'attendanceCases',...(typeof c.id==='string'?{sourceId:c.id}:{}),message:'已結案案件的當前來源未核實或已變更，須重新掃描與覆核；歷史結案狀態不能直接放行'});
    }
    return issues;
};

export const attendanceMonthIssues=(month:string,empId:string,map:Record<string,AttendanceMonthEvidence>|undefined):{trial:PayrollPreflightIssue[];formal:PayrollPreflightIssue[]}=>{
    const trial:PayrollPreflightIssue[]=[],formal:PayrollPreflightIssue[]=[];
    const add=(target:PayrollPreflightIssue[],code:PayrollPreflightIssue['code'],severity:PayrollPreflightIssue['severity'],message:string)=>target.push({code,severity,source:'attendanceMonthEvidence',message});
    if(map===undefined){
        add(formal,'CAPABILITY_MISSING','BLOCKED','整月出勤掃描證據尚未接入；既有模型試算不代表正式出勤結清');return {trial,formal};
    }
    const e=map?.[empId];
    if(!e||e.empId!==empId||e.month!==month||!['complete','unknown'].includes(e.inventory)||!['current','missing','stale','unknown'].includes(e.scan)||
        !Array.isArray(e.missingCaseIds)||!Array.isArray(e.missingDetectorInputs)||!Array.isArray(e.findings)||!Array.isArray(e.unknowns)||
        e.missingCaseIds.some(id=>typeof id!=='string'||!id)||e.missingDetectorInputs.some(key=>typeof key!=='string'||!key)||
        [...e.findings,...e.unknowns].some(o=>!o||o.empId!==empId||typeof o.id!=='string'||!o.id)||
        e.findings.some(o=>o.outcome!=='finding')||e.unknowns.some(o=>o.outcome!=='unknown')||
        (e.scan==='current'&&(typeof e.observationDigest!=='string'||!e.observationDigest))){
        add(trial,'SOURCE_UNAVAILABLE','BLOCKED','整月出勤證據缺漏、格式或員工月份範圍不符');return {trial,formal};
    }
    if(e.inventory!=='complete'||e.missingDetectorInputs.some(key=>!key.startsWith('policy.')))
        add(trial,'SOURCE_UNAVAILABLE','BLOCKED','整月出勤來源清冊未完整核實');
    if(e.scan==='stale'||e.scan==='unknown')add(trial,'APPLICATION_UNVERIFIED','BLOCKED','整月掃描證據已變更或無法核實，須重新掃描與覆核');
    if(e.missingCaseIds.length)add(trial,'SOURCE_UNAVAILABLE','BLOCKED','整月異常或保留案件尚未完整登錄，不得以空清冊放行');
    if(e.findings.length)add(trial,'CASE_UNRESOLVED','NEEDS_REVIEW','整月掃描仍有出勤異常，當前掃描不等於全部結清');
    if(e.staleAcceptedIds?.length)add(formal,'APPLICATION_UNVERIFIED','BLOCKED','歷史採納說明所依據的來源已變更，須保留原證據並明示重新送審');
    const policyUnknown=e.missingDetectorInputs.some(key=>key.startsWith('policy.'));
    if(e.scan==='missing')add(formal,'CAPABILITY_MISSING','BLOCKED','缺少不可變整月掃描證據，須明示執行掃描');
    if(policyUnknown)add(formal,'CAPABILITY_MISSING','BLOCKED','出勤偵測政策或明示工作分鐘基準尚未核定，不得宣稱正式出勤結清');
    if(e.unknowns.length){
        if(policyUnknown)add(formal,'APPLICATION_UNVERIFIED','BLOCKED','整月出勤仍有未知觀察，待政策與來源覆核');
        add(trial,'APPLICATION_UNVERIFIED','NEEDS_REVIEW','整月出勤仍有無法核實的觀察，須覆核來源；政策缺漏不能排除同時存在的來源問題');
    }
    return {trial,formal};
};

// This is the single entry point used by salary reads AND the locking transaction.
// Trial completeness is distinct from formal settlement eligibility. Missing
// required capabilities block every new lock, with no client/config override.
export const evaluatePayrollMonth = (input: {
    resolvedPaymentWithholding?:Record<string,WithholdingResult>; month: string; employees: any[]; records: ClockRecord[]; schedules: ScheduleEvent[]; leaves: LeaveRequest[]; requests: Partial<PendingSources>; revisions?: any[]; cases?: any[]; caseEvidence?: Record<string,AttendanceCaseEvidence>; attendanceMonthEvidence?: Record<string,AttendanceMonthEvidence>;
}): { status: PayrollPreflight['status']; trialStatus: PayrollPreflight['status']; salaries: SalaryDetail[] } => {
    const salaries = input.employees.map(employee => {
        const calculated = calculateSalaryForEmployee(employee, input.month, input.schedules, input.records, input.leaves,undefined,input.resolvedPaymentWithholding?.[employee.id]);
        const issues: PayrollPreflightIssue[] = (calculated.reviewReasons || []).map(message => ({ code: 'CALCULATION_REVIEW', severity: 'NEEDS_REVIEW', source: 'calculation', message }));
        issues.push(...pendingRequestIssues(input.month, employee.id, input.requests, input.records, input.schedules, input.revisions));
        issues.push(...attendanceCaseIssues(input.month,employee.id,input.cases,input.caseEvidence?.[employee.id]));
        const monthIssues=attendanceMonthIssues(input.month,employee.id,input.attendanceMonthEvidence);issues.push(...monthIssues.trial);
        if (calculated.calculationStatus !== 'ready' && !issues.length) issues.push({ code: 'CALCULATION_UNAVAILABLE', severity: 'BLOCKED', source: 'calculation', message: '計算結果尚未確認' });
        const status = issues.some(x => x.severity === 'BLOCKED') ? 'BLOCKED' : issues.length ? 'NEEDS_REVIEW' : 'READY';
        const preflight: PayrollPreflight = { version: 'preflight-v1', status: 'BLOCKED', trialStatus: status, scope: 'existing-models', issues: [...issues,...monthIssues.formal, ...PREFLIGHT_GAPS.map(gap => ({ code: 'CAPABILITY_MISSING' as const, severity: 'BLOCKED' as const, source: gap, message: `正式結算缺少必要能力或驗收：${gap}` }))], gaps: [...PREFLIGHT_GAPS] };
        if (status === 'READY') return { ...calculated, preflight };
        return { ...calculated, preflight, calculationStatus: 'needs-review' as const, reviewReasons: [...new Set(issues.map(x => x.message))],
            baseSalary: null, overtimePay: null, grossSalary: null, laborInsurance: null, healthInsurance: null, laborPensionSelf: null,
            leaveDeduction: null, totalDeductions: null, netSalary: null };
    });
    const status = !salaries.length || salaries.some(x => x.preflight.trialStatus === 'BLOCKED') ? 'BLOCKED'
        : salaries.some(x => x.preflight.trialStatus === 'NEEDS_REVIEW') ? 'NEEDS_REVIEW' : 'READY';
    return { status: 'BLOCKED', trialStatus: status, salaries };
};

export const assertPayrollReady = (result: ReturnType<typeof evaluatePayrollMonth>): void => {
    if (result.status !== 'READY' || result.trialStatus !== 'READY' || !result.salaries.length || result.salaries.some(s => s.calculationStatus !== 'ready' || !s.preflight || s.preflight.status !== 'READY' || s.preflight.gaps.length || s.preflight.issues.length)) { const error: any = new Error(`月結預檢 ${result.status}：仍有待處理申請或計薪資料待覆核`); error.statusCode = 409; throw error; }
};

// These are not implied by attendance clearance, existing OT pay classification,
// or a zero comparison. C2b currently checks daily12h/weekly40h only; its output
// remains a candidate, not full work-time/legal authorisation. No draft handbook
// or unsupported special regime can stand in for effective reviewed rules.
export const PAYROLL_PERMANENT_FORMAL_GAPS=[
 'OT_MONTHLY_AND_QUARTER_LIMITS',
 'OT_ROTATION_AND_CONSECUTIVE_REST',
 'OT_REGIME_AND_EXCEPTION_AUTHORIZATION',
 'EFFECTIVE_WORK_RULES_REVIEW',
 'PRODUCTION_RECONCILIATION',
] as const;
export interface PayrollFormalPrerequisites {
 month:string;sourceHash:string;
 reconciliation?:{satisfied:boolean;identity:unknown|null;issues:string[]};
 employees:Record<string,{empId:string;month:string;sourceHash:string;items:{satisfied:boolean};attendance:{satisfied:boolean};difference:{status:string};payment?:{satisfied:boolean;issues:string[]};worktime?:{empId:string;month:string;input:unknown;compliance:{checks:Array<{id:string;status:string}>};workRules:{status:string}}}>;
}
const formalGapMessages:Record<string,string>={
 OT_MONTHLY_AND_QUARTER_LIMITS:'月／三月工時總量尚未由完整核實來源證明符合適用限制',
 OT_ROTATION_AND_CONSECUTIVE_REST:'連續出勤、輪班間隔及例外適用尚未由核實來源證明符合',
 OT_REGIME_AND_EXCEPTION_AUTHORIZATION:'加班給付分類不等於工時制度、假日同意與緊急例外的完整合法性核定',
 EFFECTIVE_WORK_RULES_REVIEW:'適用且生效的工時制度與工作規則仍須正式核實；未有正式手冊時不得將草案當成規則',
 PAYMENT_FACTS_RECONCILIATION:'實際支付及扣繳與法定計算存在差額，尚待逐項處理；已知計算不代表實際已付清',
 PRODUCTION_RECONCILIATION:'正式資料對帳與正式驗收仍未完成，不能啟用結算',
};
/** Pure server-only annotation: preserve trial calculations and every substantive
 * issue. Only a verified employee/month proof can satisfy its corresponding
 * workflow prerequisite; each remaining prerequisite stays shut until its exact current proof is verified. */
export function annotatePayrollFormalEvidence(result:ReturnType<typeof evaluatePayrollMonth>,proof:PayrollFormalPrerequisites):ReturnType<typeof evaluatePayrollMonth>{
 const salaries=result.salaries.map(salary=>{
  const candidate=proof.employees?.[salary.empId],scoped=!!candidate&&candidate.empId===salary.empId&&candidate.month===salary.yearMonth&&candidate.month===proof.month&&candidate.sourceHash===proof.sourceHash&&!!proof.sourceHash;
  const satisfied=new Set<string>();
  if(scoped&&candidate.items?.satisfied===true)satisfied.add('PAYROLL_ITEM_REQUIREMENTS');
  if(scoped&&candidate.attendance?.satisfied===true)satisfied.add('ATTENDANCE_CASE_WORKFLOW');
  if(scoped&&candidate.difference?.status==='verified-zero')satisfied.add('MANUAL_DIFF_APPROVAL');
  if(scoped&&proof.reconciliation?.satisfied===true&&proof.reconciliation.identity&&candidate.payment?.satisfied===true)satisfied.add('PRODUCTION_RECONCILIATION');
  const worktime=scoped?candidate.worktime:undefined;
  if(worktime?.empId===salary.empId&&worktime.month===salary.yearMonth){
   const checked=(ids:string[])=>ids.every(id=>worktime.compliance.checks.filter(c=>c.id===id&&c.status==='within-checked-limits').length===1);
   if(checked(['normal-time','daily-total','monthly-overtime','cycle-overtime']))satisfied.add('OT_MONTHLY_AND_QUARTER_LIMITS');
   if(checked(['weekly-rest','rotation-rest']))satisfied.add('OT_ROTATION_AND_CONSECUTIVE_REST');
   if(worktime.input&&checked(['normal-time','daily-total','monthly-overtime','cycle-overtime','weekly-rest','rotation-rest']))satisfied.add('OT_REGIME_AND_EXCEPTION_AUTHORIZATION');
   if(worktime.workRules.status==='recorded-applicable')satisfied.add('EFFECTIVE_WORK_RULES_REVIEW');
  }
  const prior=salary.preflight;
  const gaps=[...new Set([...(prior?.gaps||PREFLIGHT_GAPS).filter(gap=>!satisfied.has(gap)),...PREFLIGHT_GAPS.filter(gap=>!satisfied.has(gap)),...PAYROLL_PERMANENT_FORMAL_GAPS.filter(gap=>!satisfied.has(gap)),...(scoped&&candidate.payment&&!candidate.payment.satisfied?['PAYMENT_FACTS_RECONCILIATION']:[])])];
  const issues=(prior?.issues||[]).filter(issue=>!(issue.code==='CAPABILITY_MISSING'&&satisfied.has(issue.source)));
  for(const gap of gaps)if(!issues.some(issue=>issue.code==='CAPABILITY_MISSING'&&issue.source===gap))issues.push({code:'CAPABILITY_MISSING',severity:'BLOCKED',source:gap,message:formalGapMessages[gap]||`本員工正式結算證據尚未完整核實：${gap}`});
  return {...salary,preflight:{...(prior||{version:'preflight-v1' as const,scope:'existing-models' as const}),status:(!gaps.length&&!issues.length&&salary.calculationStatus==='ready'&&prior?.trialStatus==='READY'?'READY':'BLOCKED') as PayrollPreflight['status'],issues,gaps}};
 });
 return {...result,status:(salaries.length&&result.trialStatus==='READY'&&salaries.every(s=>s.preflight.status==='READY')?'READY':'BLOCKED'),salaries};
}
