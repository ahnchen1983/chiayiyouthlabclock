import {handleAttendancePolicyDeclarationAction} from '../../netlify/functions/utils/attendancePolicyDeclaration';
import {handleAttendanceCaseAction} from '../../netlify/functions/utils/attendanceCaseService';
import {loadAttendanceCaseInput} from '../../netlify/functions/utils/attendanceCaseEvidence';
import {loadAttendanceScanCertificate} from '../../netlify/functions/utils/attendanceScanStorage';
import {assessAttendanceMonth} from '../../netlify/functions/utils/attendanceMonthEvidence';

export interface SyntheticAttendanceReadyOptions {
 /** This helper is only for a caller-owned fake or demo emulator database. */
 syntheticOnly:true;
 empId:string;
 month:string;
 /** Distinct, already seeded SuperAdmin identities; neither may be the subject. */
 proposer:string;
 reviewer:string;
 /** Explicit scan instant after the supplied fixture shifts have ended. */
 at:string;
 /** Supplied reviewed fixture targets. No duration/break subtraction is inferred. */
 expectedMinutesByDate:Record<string,number>;
 /** Unique within the caller's synthetic dataset. */
 operationPrefix:string;
}

/**
 * Call AFTER seeding the subject's employment/master, schedules, valid cards and
 * supervisor-verified work intervals, and both manager identities. This helper
 * never changes those inputs, assigns roles, fabricates closure histories, or
 * dispatches the sandbox outbox. Empty expectedMinutesByDate is valid only when
 * the real declaration GET reports no relevant employee schedule targets.
 *
 * Uses the real propose -> second-person approve -> scan workflow. All four
 * zero thresholds below are explicit synthetic policy choices, not production
 * defaults or deductions of an assumed break. Existing declarations are refused
 * so this fixture cannot silently overwrite a test's policy/history.
 *
 * Fresh clear observations deliberately do NOT create attendanceCases; the
 * immutable scan certificate proves the complete clear observation inventory.
 * Existing cases, if supplied, must be reconciled by the real scanner.
 */
export async function seedAttendanceReady(db:any,options:SyntheticAttendanceReadyOptions){
 const {empId,month,proposer,reviewer,at,expectedMinutesByDate,operationPrefix}=options;
 if(options.syntheticOnly!==true||!proposer||!reviewer||proposer===reviewer||[proposer,reviewer].includes(empId))throw Error('Synthetic attendance fixture requires two distinct non-subject managers');
 if(typeof at!=='string'||!Number.isFinite(Date.parse(at)))throw Error('Synthetic attendance fixture requires explicit scan instant');
 if(typeof operationPrefix!=='string'||!/^[-A-Za-z0-9_.:]{1,100}$/.test(operationPrefix))throw Error('Synthetic attendance fixture requires unique operation prefix');
 if(!expectedMinutesByDate||typeof expectedMinutesByDate!=='object'||Array.isArray(expectedMinutesByDate)||Object.values(expectedMinutesByDate).some(n=>!Number.isSafeInteger(n)||n<0))throw Error('Explicit reviewed fixture minutes are required');
 const scope={empId,month};
 const before=await handleAttendancePolicyDeclarationAction(db,proposer,'get-attendance-policy-declaration',scope);
 if(before.current)throw Error('Synthetic attendance fixture requires a fresh declaration scope');
 if(!Array.isArray(before.scheduleTargets))throw Error('Declaration GET did not provide schedule targets');
 const dates=before.scheduleTargets.map((target:any)=>target.date);
 if(new Set(dates).size!==dates.length||JSON.stringify([...dates].sort())!==JSON.stringify(Object.keys(expectedMinutesByDate).sort()))throw Error('Explicit fixture minute dates must exactly match current employee schedule targets');
 const expectedWorkByDate=Object.fromEntries(before.scheduleTargets.map((target:any)=>[target.date,{minutes:expectedMinutesByDate[target.date],scheduleVersion:target.scheduleVersion}]));
 const proposal=await handleAttendancePolicyDeclarationAction(db,proposer,'propose-attendance-policy-declaration',{
  ...scope,expectedRevision:0,operationId:operationPrefix+':propose',reason:'Explicit synthetic reviewed work-minute fixture',
  closeAfterMinutes:0,lateGraceMinutes:0,earlyGraceMinutes:0,workDifferenceTolerance:0,expectedWorkByDate,
 });
 const approved=await handleAttendancePolicyDeclarationAction(db,reviewer,'review-attendance-policy-declaration',{
  ...scope,expectedRevision:proposal.revision,operationId:operationPrefix+':approve',mode:'approve',reason:'Independent synthetic fixture policy review',
 });
 const scan=await handleAttendanceCaseAction(db,reviewer,'scan-attendance-cases',{empId,yearMonth:month},()=>new Date(at));
 const reader={get:(ref:any)=>ref.get()};
 const input=await loadAttendanceCaseInput(db,reader,empId,month,at);
 const loaded=await loadAttendanceScanCertificate(db,reader,scope);
 const caseSnapshot=await reader.get(db.collection('attendanceCases').where('empId','==',empId).limit(501));
 if(caseSnapshot.size>500)throw Error('Synthetic attendance case inventory exceeds service capacity');
 const cases=caseSnapshot.docs.map((doc:any)=>({...doc.data(),id:doc.id}));
 const assessment=assessAttendanceMonth({...scope,input,cases,certificate:loaded.certificate,explanationDigest:input.explanationInventory?.sourceDigest});
 if(loaded.status!=='loaded'||assessment.inventory!=='complete'||assessment.scan!=='current'||assessment.findings.length||assessment.unknowns.length||assessment.missingDetectorInputs.length||assessment.missingCaseIds.length){
  // Do not resolve, remove or suppress findings to make a happy fixture pass.
  throw Error('Synthetic attendance fixture is not ready: '+JSON.stringify({certificate:loaded.status,inventory:assessment.inventory,scan:assessment.scan,missingInputs:assessment.missingDetectorInputs,missingCases:assessment.missingCaseIds,observations:[...assessment.findings,...assessment.unknowns].map(o=>({type:o.type,anchor:o.anchor,outcome:o.outcome,reason:o.reason}))}));
 }
 return {proposal,approved,scan,certificateId:loaded.certificateId,certificate:loaded.certificate,assessment};
}
