import {employmentWindowStates} from '../../../utils/employmentAuthority';
import {attendanceDayHasClassification} from './attendanceOvertimeClassification';
import { isOutingLeaveType, LeaveStatus } from '../../../types';
import { clockInterval, confirmedWork, hhmmMinutes, intervalMinutes, shiftIntervals, taipeiDate, validDate } from '../../../utils/attendance';
import { validLeaveAllocations } from './payroll';
import { hasAppliedMakeup } from './makeupEvidence';
import { caseKey, evidenceHash } from './attendanceCaseLifecycle';
import { CASE_TYPES, type CaseObservation, type CaseType, type DetectorInput, type Outcome, type SourceRef, type Window } from './attendanceCaseTypes';
const midnight = (date: string) => Date.parse(date + 'T00:00:00+08:00') / 60000;
const stamp = (value: string) => Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(value || '') ? value : value + '+08:00') / 60000;
const overlap = (a: Window, b: Window) => a.start < b.end && b.start < a.end;
const intersect = (a: Window, b: Window) => ({ start: Math.max(a.start, b.start), end: Math.min(a.end, b.end) });
const valid = (a: Window) => Number.isFinite(a.start) && Number.isFinite(a.end) && a.end > a.start;
const safeMinutes = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;
const ref = (collection: string, id: string, value: unknown): SourceRef => ({ collection, id, version: evidenceHash(value) });
const sortRefs = (refs: SourceRef[]) => [...refs].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
export const scheduleDayVersion = (day: DetectorInput['schedules'][number], empId: string) => evidenceHash([day.date, day.status,
    day.shifts.filter(s => s.empId === empId).map(s => [s.from, s.to, s.endDateOffset ?? null]).sort()]);
export interface DetectionResult { observations: CaseObservation[]; settlementEligibility: 'BLOCKED'; missingCapabilities: readonly string[] }
// Pure supplied-data analysis: no fetch, DB mutation, clock read or payroll write.
export const detectAttendanceCases = (input: DetectorInput): DetectionResult => {
    if (!valid(input.window) || !Number.isFinite(input.asOf) || !input.employee.id) throw new Error('Explicit employee/window/asOf required');
    const empId = input.employee.id, observations: CaseObservation[] = [];
    if (input.records.some(r=>!r.id) || [...input.leaves,...input.makeups,...input.absences,...input.swaps].some(r=>!r.id)) throw new Error('Source identity missing; scan cannot establish completeness');
    const policy = input.policy?.version && input.policy.reviewedBy && Number.isFinite(Date.parse(input.policy.reviewedAt || '')) ? input.policy : null;
    const complete = (...names: (keyof DetectorInput['coverage'])[]) => names.every(n => input.coverage[n] === 'complete' && (n !== 'employment' || employmentWindowStates(input.employee,input.window.start,input.window.end).every(s=>s!=='unknown')));
    const emit = (type: CaseType, anchor: string, window: Window, outcome: Outcome, reason: string, refs: SourceRef[]) => {
        const sorted = sortRefs(refs);
        const o: CaseObservation = { schemaVersion: 'attendance-case-v1', detectorVersion: 'detector-v1', id: caseKey(empId, type, anchor), empId, type, anchor,
            window, outcome, reason, refs: sorted, policyVersion: policy?.version || null, payrollDecision: 'none', evidenceVersion: '' };
        o.evidenceVersion = evidenceHash([o.detectorVersion, type, anchor, window, outcome, reason, sorted, policy, input.coverage]);
        observations.push(o);
    };
    const employmentKnown = complete('employment');
    // Expand to complete selected shifts before filtering source evidence. A
    // narrow month window must not erase the preceding part of an overnight.
    const selectedShifts = input.schedules.filter(d=>d.shifts.some(s=>s.empId===empId)).map(d=>({date:d.date,ranges:(shiftIntervals(d.shifts.filter(s=>s.empId===empId))||[]).map(r=>({start:midnight(d.date)+r.start,end:midnight(d.date)+r.end}))})).filter(d=>d.ranges.some(r=>overlap(r,input.window)));
    const requiredDates = new Set(selectedShifts.map(d=>d.date));
    const cards = input.records.filter(r => r.empId === empId).map(r => {
        const span = clockInterval(r), work = confirmedWork(r), base = midnight(r.date);
        const absolute = [r.clockInAt, r.clockOutAt].filter(Boolean).map(stamp).filter(Number.isFinite);
        const range = span ? { start: base + span.start, end: base + span.end } : { start: Math.min(base,...absolute), end: Math.max(base + 2880,...absolute.map(n=>n+1)) };
        return { r, span, range, work: work?.map(w => ({start: base+w.start,end:base+w.end})) ?? null,
            ref: ref('clockRecords', r.id, [r.date, r.clockInTime, r.clockOutTime, r.clockInAt, r.clockOutAt, r.workIntervals, r.workReview, r.attendanceRevisionId]) };
    }).filter(c => !valid(c.range) || overlap(c.range, input.window) || requiredDates.has(c.r.date));
    const evidenceWindows=[input.window,...selectedShifts.flatMap(d=>d.ranges),...cards.map(c=>c.range)];
    const relevantLeaves = input.leaves.filter(l => l.empId === empId && (evidenceWindows.some(w=>overlap({start:stamp(l.startDate),end:stamp(l.endDate)},w)) || !valid({start:stamp(l.startDate),end:stamp(l.endDate)})));
    const explanations = relevantLeaves.filter(l => l.status === LeaveStatus.Approved && !!l.approver && Number.isFinite(Date.parse(l.approvalDate || '')) && validLeaveAllocations(l)).flatMap(l => l.payrollAllocations!.map(a => ({
        start: midnight(a.date) + hhmmMinutes(a.from)!, end: midnight(a.date) + (a.to === '24:00' ? 1440 : hhmmMinutes(a.to)!),
        outing: isOutingLeaveType(l.leaveType), ref: ref('leaveRequests',l.id,[l.startDate,l.endDate,l.leaveType,l.hours,l.payrollAllocations,l.approver,l.approvalDate]),
    })));
    for (const a of input.absences.filter(a=>a.empId===empId && a.status==='核准')) {
        if (a.approver && Number.isFinite(Date.parse(a.approvalDate || '')) && validDate(a.startDate) && a.startDate===input.employee.leaveOfAbsenceStart && (a.endDate||'')===(input.employee.leaveOfAbsenceEnd||'')) {
            const range = {start:midnight(a.startDate),end:a.endDate?midnight(a.endDate)+1440:input.window.end};
            if (valid(range)) explanations.push({...range,outing:false,ref:ref('leaveOfAbsenceRequests',a.id,[a.startDate,a.endDate,a.approver,a.approvalDate])});
        }
    }
    const allDayRanges: Window[] = [];
    const scheduleDays = new Map<string, DetectorInput['schedules']>();
    for (const d of input.schedules) if (d.shifts.some(s=>s.empId===empId)) scheduleDays.set(d.date,[...(scheduleDays.get(d.date)||[]),d]);
    for (const [date, entries] of scheduleDays) {
        const shifts = entries.flatMap(d=>d.shifts.filter(s=>s.empId===empId));
        const spans = shiftIntervals(shifts), base=midnight(date);
        const ranges = spans?.map(s=>({start:base+s.start,end:base+s.end})) || [];
        const dayWindow = ranges.length ? {start:Math.min(...ranges.map(r=>r.start)),end:Math.max(...ranges.map(r=>r.end))} : {start:base,end:base+2880};
        if (valid(dayWindow) && !overlap(dayWindow,input.window)) continue;
        if (!valid(dayWindow)) throw new Error('Invalid schedule date; adapter must quarantine malformed source');
        allDayRanges.push(...ranges);
        const dayCards = cards.filter(c=>!valid(c.range) || overlap(c.range,dayWindow));
        const attributedCards = cards.filter(c=>c.r.date===date);
        const dayExplanation = explanations.filter(e=>overlap(e,dayWindow));
        const refs=[...entries.map(d=>({collection:'dailySchedule',id:d.date,version:scheduleDayVersion(d,empId)})),...cards.filter(c=>dayCards.includes(c)||attributedCards.includes(c)).map(c=>c.ref),...dayExplanation.map(e=>e.ref),ref('employment',empId,input.employee)];
        const scheduleOK = complete('schedules') && entries.length===1 && entries[0].status==='營運' && !!spans && validDate(date);
        const inEmployment = employmentKnown && ranges.every(r=>employmentWindowStates(input.employee,r.start,r.end).every(s=>s==='active'));
        if (employmentKnown && ranges.length && ranges.every(r=>employmentWindowStates(input.employee,r.start,r.end).every(s=>s==='not-employed'))) {
            for (const type of ['unexplained-absence','late','early','hours-difference'] as const) emit(type,'schedule-day:'+date,dayWindow,'clear','班段不在已知雇用有效期間，不推定出勤義務',refs);
            continue;
        }
        const settled = policy && safeMinutes(policy.closeAfterMinutes) && input.asOf >= dayWindow.end + policy.closeAfterMinutes;
        const explained = ranges.length>0 && ranges.every(r=>intervalMinutes(dayExplanation.map(e=>intersect(r,e)))===r.end-r.start);
        const unverifiedExplanation = relevantLeaves.some(l=>l.status===LeaveStatus.Approved && overlap({start:stamp(l.startDate),end:stamp(l.endDate)},dayWindow) && (!l.approver||!Number.isFinite(Date.parse(l.approvalDate || ''))||!validLeaveAllocations(l)));
        const unverifiedMakeup = input.makeups.some(m=>m.empId===empId && m.status==='核准' && (m.date===date || dayCards.some(c=>c.r.id===m.recordId)) && (!complete('revisions') || !hasAppliedMakeup(m,input.records,input.revisions)));
        const noEvidenceGap = complete('records','requests','explanations') && scheduleOK && inEmployment && !unverifiedExplanation && !unverifiedMakeup && dayCards.every(c=>!!c.span);
        const presence = dayCards.filter(c=>c.span).map(c=>c.range);
        const uncovered = ranges.some(r=>intervalMinutes([...presence,...dayExplanation].map(e=>intersect(r,e)))===0);
        const anchor='schedule-day:'+date; // intentional daily aggregation for legacy shifts without stable IDs
        emit('unexplained-absence',anchor,dayWindow,!noEvidenceGap||!settled?'unknown':uncovered&&!explained?'finding':'clear',!noEvidenceGap||!settled?'資料、雇用區間或結班政策待核；不得判曠職':'班段出勤／核准解釋覆蓋檢查（不作扣薪決策）',refs);
        const usable = noEvidenceGap && !!settled && dayCards.every(c=>!!c.span) && (dayExplanation.length===0 || explained);
        let late=false,early=false;
        for(const r of ranges){
            const cover=[...presence,...dayExplanation].filter(x=>overlap(x,r));
            if(!cover.length)continue;
            late ||= Math.min(...cover.map(c=>c.start)) > r.start + (policy?.lateGraceMinutes ?? 0);
            early ||= Math.max(...cover.map(c=>c.end)) < r.end - (policy?.earlyGraceMinutes ?? 0);
        }
        emit('late',anchor,dayWindow,!usable||!safeMinutes(policy?.lateGraceMinutes)?'unknown':late?'finding':'clear',!usable||!safeMinutes(policy?.lateGraceMinutes)?'遲到容許或有效來源待核':'起點差異候選，不裁切實際工作',refs);
        emit('early',anchor,dayWindow,!usable||!safeMinutes(policy?.earlyGraceMinutes)?'unknown':early?'finding':'clear',!usable||!safeMinutes(policy?.earlyGraceMinutes)?'早退容許或有效來源待核':'終點差異候選，不裁切實際工作',refs);
        const target=policy?.expectedWorkByDate?.[date];
        const targetValid=target && safeMinutes(target.minutes) && target.reviewedBy && target.scheduleVersion===scheduleDayVersion(entries[0],empId);
        const workOK=usable && policy?.workDateRule==='clock-in-date' && attributedCards.every(c=>!!c.span && (!c.r.clockInAt || taipeiDate(new Date(stamp(c.r.clockInAt)*60000))===date)) && policy?.breaks==='explicit' && targetValid && safeMinutes(policy.workDifferenceTolerance) && attributedCards.every(c=>c.work!==null) && dayExplanation.length===0;
        // Count complete confirmed work by the explicit work-date rule. Neither
        // schedule boundaries nor the scan window may trim approved minutes.
        const workMinutes=intervalMinutes(attributedCards.flatMap(c=>c.work||[]));
        emit('hours-difference',anchor,dayWindow,explained&&noEvidenceGap&&settled?'clear':!workOK?'unknown':Math.abs(workMinutes-target.minutes)>policy.workDifferenceTolerance?'finding':'clear',!workOK&&!explained?'實際工作／休息或淨應工作分鐘基準待覆核':'已確認工作與明示分鐘基準比較（不決定薪資）',refs);
    }
    for(const c of cards){
        if(!valid(c.range))throw new Error('Invalid card date; adapter must quarantine malformed source');
        const anchor='card:'+c.r.id, refs=[c.ref], known=complete('records');
        const hasIn=!!(c.r.clockInAt||c.r.clockInTime),hasOut=!!(c.r.clockOutAt||c.r.clockOutTime);
        const validIn=c.r.clockInAt?Number.isFinite(stamp(c.r.clockInAt)):hhmmMinutes(c.r.clockInTime)!==null;
        const validOut=c.r.clockOutAt?Number.isFinite(stamp(c.r.clockOutAt)):hhmmMinutes(c.r.clockOutTime)!==null;
        const sameDay=input.schedules.filter(d=>d.date===c.r.date).flatMap(d=>shiftIntervals(d.shifts.filter(s=>s.empId===empId))||[]);
        const expectedEnd=sameDay.length?midnight(c.r.date)+Math.max(...sameDay.map(r=>r.end)):NaN;
        const closed=hasOut || (!!policy && safeMinutes(policy.closeAfterMinutes) && Number.isFinite(expectedEnd) && input.asOf>=expectedEnd+policy.closeAfterMinutes);
        emit('missing-in',anchor,c.range,!known||(hasIn&&!validIn)?'unknown':!hasIn?'finding':'clear','原卡／有效投影是否缺上班事件，不代填班表',refs);
        emit('missing-out',anchor,c.range,!known||(hasOut&&!validOut)||(!hasOut&&!closed)?'unknown':!hasOut?'finding':'clear',!hasOut&&!closed?'尚在出勤或結班政策未知':'原卡／有效投影是否缺下班事件',refs);
        const matching=allDayRanges.some(r=>overlap(r,c.range));
        emit('unscheduled-card',anchor,c.range,!known||!complete('schedules')?'unknown':matching?'clear':'finding','有出勤證據但無相交班段候選；不否認工作',refs);
        const inAt=c.r.clockInAt?stamp(c.r.clockInAt):NaN,outAt=c.r.clockOutAt?stamp(c.r.clockOutAt):NaN;
        const invalidOrder=Number.isFinite(inAt)&&Number.isFinite(outAt)&&outAt<=inAt;
        const duplicates=cards.filter(x=>x!==c && ((x.span&&c.span&&overlap(x.range,c.range)) || (x.r.id===c.r.id)));
        emit('sequence-overlap',anchor,c.range,!known?'unknown':invalidOrder||duplicates.length?'finding':hasIn&&hasOut&&!c.span?'unknown':'clear','重複、逆序及跨紀錄重疊檢查；不刪原卡',[...refs,...duplicates.map(d=>d.ref)]);
        const absolute=!!c.r.clockInAt&&!!c.r.clockOutAt;
        const wrongDate=Number.isFinite(inAt)&&taipeiDate(new Date(inAt*60000))!==c.r.date;
        const ambiguous=hasIn&&hasOut&&!c.span;
        const cross=c.span && c.span.end>1440;
        emit('overnight-date',anchor,c.range,!known?'unknown':wrongDate?'finding':ambiguous||(cross&&(!absolute||policy?.workDateRule!=='clock-in-date'))?'unknown':'clear','完整時間與日期／歸屬政策檢查；舊跨夜資訊不猜測',refs);
        const leaveOverlap=explanations.filter(e=>!e.outing && (c.work||[]).some(w=>overlap(w,e)));
        const incompleteLeave=relevantLeaves.some(l=>l.status===LeaveStatus.Approved && (!l.approver||!Number.isFinite(Date.parse(l.approvalDate || ''))||!validLeaveAllocations(l)));
        emit('work-leave-overlap',anchor,c.range,!known||!complete('requests')||c.work===null||incompleteLeave?'unknown':leaveOverlap.length?'finding':'clear','已核工作與核准假別分鐘相交；外勤不視為休假',[...refs,...leaveOverlap.map(e=>e.ref)]);
    }
    // Calendar-day candidate only, never a statutory day classification or pay decision.
    if(input.overtimes){
      const days=new Map<string,{ranges:Window[];refs:SourceRef[];unknown:boolean}>();
      for(const r of input.records.filter(r=>r.empId===empId&&validDate(r.date))){const work=confirmedWork(r),base=midnight(r.date),span=clockInterval(r);const boundaries=work?.length?work:span?[span]:[{start:0,end:1440}];
        for(const part of boundaries){let pos=base+part.start;while(pos<base+part.end){const date=taipeiDate(new Date(pos*60000)),end=Math.min(midnight(date)+1440,base+part.end),day=days.get(date)||{ranges:[],refs:[],unknown:false};day.unknown ||= work===null;day.refs.push(ref('clockRecords',r.id,r));if(work?.length)day.ranges.push({start:pos,end});days.set(date,day);pos=end;}}
      }
      for(const [date,day] of days){
       const w={start:midnight(date),end:midnight(date)+1440};if(!overlap(w,input.window))continue;
       const classified=!day.unknown&&intervalMinutes(day.ranges)>480&&attendanceDayHasClassification(input.overtimeClassification,empId,taipeiDate(new Date(input.window.start*60000)).slice(0,7),date,input.records,day.ranges);
       emit('hours-difference','overtime-candidate:'+date,w,day.unknown||intervalMinutes(day.ranges)>480&&!classified?'unknown':'clear',
        classified?'已核實既有模型工作／加班逐段分類；不代表法定加班授權、完整法遵核定或付款':'已核區間超過8小時或來源不完整須調查；日別、法遵上限與依法應付待獨立核定，不以無申請歸零',
        classified?[...day.refs,{collection:'attendanceOvertimeClassification',id:empId+':'+input.overtimeClassification!.month,version:input.overtimeClassification!.evidenceVersion}]:day.refs);
      }
    }
    const groups=[['compRequests',input.comps||[]],['overtimeRequests',input.overtimes||[]],['makeupRequests',input.makeups],['leaveRequests',input.leaves],['leaveOfAbsenceRequests',input.absences],['shiftSwapRequests',input.swaps]] as const;
    for(const [collection,requests] of groups)for(const r of requests){
        const q:any=r; if(collection==='shiftSwapRequests'?![q.fromEmpId,q.toEmpId].includes(empId):q.empId!==empId)continue;
        const requestRanges: Window[] = collection==='shiftSwapRequests'
            ? [q.fromDate,q.toDate].map(d=>({start:midnight(d),end:midnight(d)+1440}))
            : collection==='makeupRequests'
                ? [{start:midnight(q.date),end:midnight(q.date)+1440}, ...[q.requestedClockInAt,q.requestedClockOutAt].filter(Boolean).map(t=>({start:stamp(t),end:stamp(t)+1}))]
                : [{start: q.startDate?.length===10?midnight(q.startDate):stamp(q.startDate),end: !q.endDate?input.window.end:q.endDate.length===10?midnight(q.endDate)+1440:stamp(q.endDate)}];
        const impactWindows=[input.window,...cards.map(c=>c.range),...allDayRanges];
        if(requestRanges.every(valid)&&!requestRanges.some(r=>impactWindows.some(w=>overlap(r,w))))continue;
        const refs=[ref(collection,q.id,q),...cards.map(c=>c.ref),...input.revisions.filter(r=>r.after?.empId===empId || r.before?.empId===empId).map(r=>ref('attendanceRevisions',r.id,r)),ref('employment',empId,input.employee)],anchor=collection+':'+q.id;
        const pending=collection==='compRequests'?['submitted','pending-policy','needs-info','pending-payroll'].includes(q.status):collection==='overtimeRequests'?['submitted','needs-info','preauthorized'].includes(q.status):collection==='shiftSwapRequests'?['awaiting-peer','awaiting-admin'].includes(q.status):collection==='makeupRequests'?['待審核','待補件'].includes(q.status):['待審核','待補件'].includes(q.status);
        const approved=collection==='compRequests'?q.status==='approved':collection==='overtimeRequests'?['approved','partial-approved'].includes(q.status):collection==='shiftSwapRequests'?q.status==='approved':q.status==='核准';
        const rejected=collection==='compRequests'?['cancelled','rejected','superseded'].includes(q.status):collection==='overtimeRequests'?['rejected','cancelled','superseded'].includes(q.status):collection==='shiftSwapRequests'?['rejected-by-peer','rejected-by-admin','cancelled'].includes(q.status):collection==='makeupRequests'?['駁回','已取消','已取代'].includes(q.status):['駁回','已取消','已取代'].includes(q.status);
        emit('pending-request',anchor,input.window,!complete('requests')||(!pending&&!approved&&!rejected)?'unknown':pending?'finding':'clear','申請狀態檢查；待審或未知不等於已解決',refs);
        let applied: boolean|null=null;
        if(approved&&collection==='makeupRequests'&&complete('records','revisions')) applied=hasAppliedMakeup(q,input.records,input.revisions);
        if(approved&&collection==='leaveRequests')applied=!!q.approver&&Number.isFinite(Date.parse(q.approvalDate || ''))&&validLeaveAllocations(q);
        if(approved&&collection==='leaveOfAbsenceRequests'&&complete('employment')&&!input.employee.employmentAuthority)applied=validDate(q.startDate)&&(!q.endDate||(validDate(q.endDate)&&q.endDate>=q.startDate))&&!!q.approver&&Number.isFinite(Date.parse(q.approvalDate || ''))&&q.startDate===input.employee.leaveOfAbsenceStart&&(q.endDate||'')===(input.employee.leaveOfAbsenceEnd||'');
        // Legacy swaps have no stable before/after application linkage. A status
        // alone cannot attest their effect; B2 must supply a verified adapter.
        emit('approved-unapplied',anchor,input.window,!complete('requests')||(!pending&&!approved&&!rejected)?'unknown':!approved?'clear':applied===true?'clear':applied===false?'finding':'unknown','核准來源與有效投影證據檢查；缺鏈不宣稱已反映',refs);
    }
    // Explicit source-scope observations retain uncertainty even with empty arrays.
    for(const type of CASE_TYPES) if(!observations.some(o=>o.type===type) || !complete('records','schedules','requests','employment','revisions','explanations')) {
        emit(type,'scope',input.window,complete('records','schedules','requests','employment','revisions','explanations')?'clear':'unknown','範圍資料完整度檢查；空資料不替代來源完整性',[]);
    }
    const unique = new Map<string, CaseObservation>();
    for (const o of observations) {
        const prior=unique.get(o.id);
        if (!prior) { unique.set(o.id,o); continue; }
        const merged={...o, outcome: (o.type==='sequence-overlap'?'finding':'unknown') as Outcome,
            reason:'同一來源識別出現多份投影，需核對來源，不自動選取', refs:sortRefs([...prior.refs,...o.refs]),
            window:{start:Math.min(prior.window.start,o.window.start),end:Math.max(prior.window.end,o.window.end)}};
        merged.evidenceVersion=evidenceHash([merged.detectorVersion,merged.refs,merged.window,merged.outcome,policy]);
        unique.set(o.id,merged);
    }
    return { observations: [...unique.values()].sort((a,b)=>a.id.localeCompare(b.id)), settlementEligibility:'BLOCKED', missingCapabilities:['PERSISTED_CASE_WORKFLOW','SCOPED_AUTHORIZATION','TRANSACTION_GUARD','NOTIFICATION_DELIVERY','OT_COMP_MODEL','PRODUCTION_RECONCILIATION'] };
};
