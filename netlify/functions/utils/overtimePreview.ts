import {calculateOvertime,type OTInput,type OTResult,type OTWork} from '../../../utils/payroll/overtime';
import type {NormalPayDay,NormalPayInterval} from '../../../utils/payroll/normalPay';
import {evidenceHash} from './attendanceCaseLifecycle';
/** Only called with effectiveMaster's server-loaded policy documents. No request
 * payload can supply wage proofs, day classifications, source versions or work.
 * C2b2 is a supplementary candidate: it does not add into netSalary or snapshots.
 */
// approvalId is reviewer+'@'+ISO time; split on the last '@' since a reviewer id
// may itself contain '@' but an ISO timestamp never does.
const reviewProof=(id:string)=>{const at=id.lastIndexOf('@');return at>0?{reviewedBy:id.slice(0,at),reviewedAt:id.slice(at+1)}:{reviewedBy:'missing',reviewedAt:'invalid'};};
export function overtimePreview(days:NormalPayDay[],intervals:NormalPayInterval[]):OTResult {
 const issues:string[]=[],configs=new Map<string,any>();
 for(const d of days){const p=d.policy,config=(p as any)?.overtime;
  if(!config)continue;
  if(p?.status!=='approved'||typeof p.version!=='string'||typeof p.approvedBy!=='string'||!Number.isFinite(Date.parse(p.approvedAt))){issues.push('日別加給政策來源未核定');continue;}
  configs.set(evidenceHash(config),config);
 }
 // A versioned scope containing a complete week may span payroll months. Multiple
 // incompatible policy snapshots are not shallow-merged into an invented policy.
 const config=configs.size===1?[...configs.values()][0]:null;
 if(!config||config.schemaVersion!=='overtime-scope-v1')issues.push('完整日別／正常工資組成／跨月週界來源待核定');
 if(configs.size>1)issues.push('日別加給多版本範圍衝突，需明確合併覆核');
 const work:OTWork[]=intervals.filter(i=>i.kind==='work').map(i=>({id:i.sourceId,sourceVersion:i.sourceVersion,start:i.start,end:i.end,workdayId:i.workday?.id||'unmapped:'+i.sourceId,kind:'actual',version:i.sourceVersion,...reviewProof(i.approvalId)}));
 // Approved leave allocations do not prove offsite work or the specific personal
 // leave compliance classification. Those need a source-bound dedicated adapter.
 if(intervals.some(i=>i.kind==='leave'))issues.push('假單12h合規分類／外勤來源專用投影待核；不得把假直接當actual');
 const input:OTInput={workdays:Array.isArray(config?.workdays)?config.workdays:[],wages:Array.isArray(config?.wages)?config.wages:[],weeks:Array.isArray(config?.weeks)?config.weeks:[],work,comp:[],compEvidenceComplete:false};
 for(const w of input.workdays){const d=days.find(d=>d.date===w?.date);if(d&&(d.dayType!==w.dayType||intervals.some(i=>i.workday?.id===w.id&&i.workday.date!==w.date)))issues.push('核定主檔日別／工日與加給範圍不一致');}
 for(const wage of input.wages){if(days.some(d=>{const start=Date.parse(d.date+'T00:00:00+08:00')/60000;return wage?.start<start+1440&&wage?.end>start&&d.payBasis!==wage.payBasis;}))issues.push('工資來源薪制與有效主檔不一致');}
 let result:OTResult;try{result=calculateOvertime(input);}catch{result=calculateOvertime({workdays:[],work:[],wages:[],weeks:[],comp:[],compEvidenceComplete:false});issues.push('日別加給範圍資料格式無效，不能計為零');}
 result.issues=[...new Set([...result.issues,...issues,'跨月完整週工作來源、補休原日帳本逐段對帳與月／三月法遵尚未接入，不能正式計付'])];result.status='needs-review';
 return result;
}
