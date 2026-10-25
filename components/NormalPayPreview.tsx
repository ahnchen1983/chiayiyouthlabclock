import React from 'react';
import type {NormalPayResult} from '../utils/payroll/normalPay';
import {normalPayCSV} from '../utils/payroll/normalPayExport';
const frac=(f?:{numerator:string;denominator:string}|null)=>f?f.numerator+'/'+f.denominator:'待覆核';
// Shows the API evidence verbatim: normal pay + overtime, exact segments, one final rounding.
export default function NormalPayPreview({result}:{result?:NormalPayResult}){
 if(!result)return null;
 const c=result.combined,ot=result.overtimePreview,issues=c?.issues??result.issues;
 const download=()=>{const url=URL.createObjectURL(new Blob(['﻿'+normalPayCSV(result)],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=`薪資計算明細_${result.month}.csv`;a.click();URL.revokeObjectURL(url);};
 return <section className="my-3 p-3 border rounded bg-amber-50 break-words"><h3>薪資計算明細（正常工資＋加班費）</h3>
  <p>本月合計：{c?.amount??'待覆核'}（正常工資：{result.amount??'待覆核'}；加班費精確值：{frac(c?.overtimeExact)}）</p>
  {issues.length>0&&<><p>尚待處理，處理完才會出合計：</p><ul>{issues.map((s,i)=><li key={i}>{s}</li>)}</ul></>}
  <p>精確合計：{frac(c?.exactTotal)}；各分段不先進位，只在最後合計進位（{result.rounding?.version||'進位政策待核'}）</p>
  <button onClick={download}>下載薪資計算明細 CSV</button>
  <details><summary>查看正常工資分段</summary>{result.segments.map((s,i)=><div className="border-t py-2" key={i}>{s.date} · {s.kind} · {s.minutes??'曆日'}<p>精確 {s.exact.numerator}/{s.exact.denominator}；薪資版本 {s.payVersion}；政策 {s.policyId}/{s.policyVersion}；來源 {s.sourceIds.join('、')}</p></div>)}</details>
  {ot&&<details><summary>查看加班費分段</summary>
   {ot.complianceIssues.length>0&&<><p>法遵提醒（不影響給付）：</p><ul>{ot.complianceIssues.map((s,i)=><li key={i}>{s}</li>)}</ul></>}
   {ot.lines.map((line,i)=><div key={i} className="border-t py-2">{line.date} · {line.dayType} · {line.kind} · {line.minutes} 分鐘<p>精確金額 {line.exact?line.exact.numerator+'/'+line.exact.denominator:'待核'}；工資來源 {line.basisId}/{line.basisVersion}；倍率 {line.multiplier?line.multiplier.numerator+'/'+line.multiplier.denominator:'待核'}；來源 {line.sourceIds.map((id,n)=>id+'（版本：'+line.sourceVersions[n]+'）').join('、')}</p></div>)}</details>}
 </section>;
}
