import type {NormalPayResult} from './normalPay';
const cell=(v:unknown)=>'"'+String(v??'').replace(/"/g,'""').replace(/^([=+@\-])/,'\t$1')+'"';
/** Export the API evidence verbatim; do not recompute or round in UI/export. */
export function normalPayCSV(r:NormalPayResult):string{const c=r.combined,ot=r.overtimePreview,f=(x:any)=>x?x.numerator+'/'+x.denominator:'';return [
 ['薪資計算：正常工資＋加班費',r.month,c?.status??r.status,c?.amount??'待覆核',f(c?.exactTotal)],
 ['正常工資',r.status,r.amount??'待覆核',f(r.exactTotal)],
 ['員工','日期','起分鐘','迄分鐘','項目','分鐘','薪資版本','政策ID','政策版本','來源','精確分子','精確分母','分項捨入值'],
 ...r.segments.map(s=>[s.employeeId,s.date,s.start,s.end,s.kind,s.minutes,s.payVersion,s.policyId,s.policyVersion,s.sourceIds.join(';'),s.exact.numerator,s.exact.denominator,s.rounded]),
 ...(ot?[['加班費',ot.status,f(ot.monthExact)||'待覆核'],...ot.lines.map(l=>['加班費分段',l.date,l.start,l.end,l.kind,l.minutes,l.basisId,l.basisVersion,l.sourceIds.join(';'),l.exact?.numerator??'待核非零元',l.exact?.denominator??'',l.multiplier?.numerator??'',l.multiplier?.denominator??'',JSON.stringify(l.sourceIds.map((id,n)=>({id,version:l.sourceVersions[n]})))]),['法遵提醒（不影響給付）',...ot.complianceIssues]]:[]),
 ['待覆核原因',...(c?.issues??r.issues)]
 ].map(row=>row.map(cell).join(',')).join('\n');}
