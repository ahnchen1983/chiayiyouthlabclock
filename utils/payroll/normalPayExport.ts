import type {NormalPayResult} from './normalPay';
const cell=(v:unknown)=>'"'+String(v??'').replace(/"/g,'""').replace(/^([=+@\-])/,'\t$1')+'"';
/** Export the API evidence verbatim; do not recompute or round in UI/export. */
export function normalPayCSV(r:NormalPayResult):string{return [
 ['非結算：正常薪資分段覆核',r.month,r.status,r.amount??'待覆核',r.exactTotal.numerator+'/'+r.exactTotal.denominator],
 ['員工','日期','起分鐘','迄分鐘','項目','分鐘','薪資版本','政策ID','政策版本','來源','精確分子','精確分母','分項捨入值'],
 ...r.segments.map(s=>[s.employeeId,s.date,s.start,s.end,s.kind,s.minutes,s.payVersion,s.policyId,s.policyVersion,s.sourceIds.join(';'),s.exact.numerator,s.exact.denominator,s.rounded]),
 ...(r.overtimePreview?[['日別加給候選未採用','已知分段合計',r.overtimePreview.knownLiability.numerator,r.overtimePreview.knownLiability.denominator],...r.overtimePreview.lines.map(l=>['加給候選',l.date,l.start,l.end,l.kind,l.minutes,l.basisId,l.basisVersion,l.sourceIds.join(';'),l.exact?.numerator??'待核非零元',l.exact?.denominator??'',l.multiplier?.numerator??'',l.multiplier?.denominator??'',JSON.stringify(l.sourceIds.map((id,n)=>({id,version:l.sourceVersions[n]})))]),['加給待核',...r.overtimePreview.issues,...r.overtimePreview.complianceIssues]]:[]),
 ['待覆核原因',...r.issues],['法定加班金額','待C2b','不得據此發薪']
 ].map(row=>row.map(cell).join(',')).join('\n');}
