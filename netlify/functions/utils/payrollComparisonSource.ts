import type {SalaryDetail} from '../../../types';
import {assessPayrollItemInventory,type PayrollItemInventoryVersion} from '../../../utils/payroll/items';
import {comparisonDecimal,comparisonFraction,type PayrollComparisonLine,type PayrollComparisonSource,type PayrollComparisonSourceRef} from '../../../utils/payroll/comparison';
import {add,decimal,evidence,mul,rational,rounded,sum,validRounding,type FractionEvidence} from '../../../utils/payroll/rational';
import {evidenceHash} from './attendanceCaseLifecycle';
import {validDate} from '../../../utils/attendance';

const numberAmount=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?comparisonDecimal(String(v)):null;
const same=(a:FractionEvidence|null|undefined,b:FractionEvidence|null|undefined)=>{const x=comparisonFraction(a),y=comparisonFraction(b);return !!x&&!!y&&x.n*y.d===y.n*x.d;};
const zero=evidence(rational(0n));
const token=(x:unknown)=>typeof x==='string'&&x.length>0&&x.length<=256&&!/[\s/\\]/.test(x);

/** Server-only adapter over existing calculation evidence. It deliberately does
 * not load data, calculate statutory rules or accept client supplied overrides.
 * The caller must supply a digest of the complete canonical payroll inputs and
 * immutable insurance/item identities verified by their owning loaders. No API
 * or approval workflow calls this prerequisite until that integration is done. */
type ProjectionInput={salary:SalaryDetail;sources:PayrollComparisonSourceRef[];inventory?:PayrollItemInventoryVersion|null};
export function projectPayrollComparisonSource(input:ProjectionInput):PayrollComparisonSource {
 try{return project(input);}catch{
  const result:Omit<PayrollComparisonSource,'sourceHash'>={schemaVersion:'payroll-comparison-source-v1',empId:typeof input?.salary?.empId==='string'?input.salary.empId:'',month:typeof input?.salary?.yearMonth==='string'?input.salary.yearMonth:'',calculationVersion:null,status:'needs-review',sources:[],lines:[],totals:{gross:null,deductions:null,net:null},inventoryStatus:'unreviewed',rounding:null,issues:['比較來源格式無效，不能產生已核定金額'],formalEligibility:'BLOCKED',applicationStatus:'not-applied',paymentStatus:'not-paid'};
  return {...result,sourceHash:evidenceHash(result)};
 }
}
function project(input:ProjectionInput):PayrollComparisonSource {
 const s=input.salary,issues:string[]=[],lines:PayrollComparisonLine[]=[];
 const sources:PayrollComparisonSourceRef[]=[];
 for(const ref of Array.isArray(input.sources)?input.sources:[]){
  if(!ref||!['payroll-inputs','insurance-timeline','payroll-item-inventory','payroll-item-execution'].includes(ref.kind)||!token(ref.id)||!token(ref.version)){issues.push('比較來源版本識別無效');continue;}
  if(sources.some(r=>r.kind===ref.kind)){issues.push('比較來源類別重複');continue;}
  sources.push({kind:ref.kind,id:ref.id,version:ref.version});
 }
 sources.sort((a,b)=>a.kind.localeCompare(b.kind));
 const payroll=sources.filter(r=>r.kind==='payroll-inputs'),insurance=sources.filter(r=>r.kind==='insurance-timeline'),itemRefs=sources.filter(r=>r.kind==='payroll-item-inventory');
 if(!token(s.empId)||!validDate(s.yearMonth+'-01')||!token(s.calculationVersion))issues.push('比較員工／月份／計算版本無效');
 if(!payroll.length)issues.push('完整計薪來源摘要尚未載入');
 const globallyReady=s.calculationStatus==='ready'&&!(s.reviewReasons?.length);
 if(!globallyReady)issues.push(...(s.reviewReasons?.length?s.reviewReasons:['薪資計算尚待覆核']));
 const addLine=(code:string,kind:'earning'|'deduction',exact:unknown,amount:unknown,ready:boolean,refs:PayrollComparisonSourceRef[],why:string[])=>{
  const value=comparisonFraction(exact),money=typeof amount==='string'?comparisonDecimal(amount):numberAmount(amount);
  const valid=!!value&&value.n>=0n&&money!==null&&ready&&globallyReady&&!!payroll.length;
  const lineIssues=valid?[]:[...why,`${code} 比較金額或來源未完整核定`];
  const line:PayrollComparisonLine={code,kind,status:valid?'confirmed':'needs-review',exact:value?evidence(value):null,amount:valid?money:null,sourceRefs:refs,issues:lineIssues};
  lines.push(line);issues.push(...lineIssues);return line;
 };
 const n=s.normalPayPreview,c=n?.combined;
 // Validate the existing payroll.ts cumulative allocation, not a new rounding
 // rule: normal is rounded first, OT is the normal+OT cumulative residual, and
 // comp settlement is the final gross residual. Never accept balancing edits
 // that happen to preserve gross/net while changing those displayed components.
 const normalExact=comparisonFraction(c?.normalExact),otExact=comparisonFraction(c?.overtimeExact),totalExact=comparisonFraction(c?.exactTotal);
 const inv=input.inventory,assessment=assessPayrollItemInventory(inv),app=s.itemApplication;
 const inventoryBound=!!inv&&inv.empId===s.empId&&inv.month===s.yearMonth&&itemRefs.some(r=>r.id===inv.id&&r.version===String(inv.revision));
 let itemValid=!!app&&app.status==='ready'&&!app.issues.length&&app.applicationStatus==='calculated-not-posted'&&app.paymentStatus==='not-paid'&&
  !!app.source&&sources.some(r=>r.kind==='payroll-item-execution'&&r.id===app.source!.id&&r.version===app.source!.evidenceVersion)&&token(app.source.id)&&Number.isSafeInteger(app.source.revision)&&app.source.revision>0&&token(app.source.evidenceVersion)&&
  inventoryBound&&assessment.status==='recorded-items-needs-classification'&&Array.isArray(app.lines)&&app.lines.length===assessment.items.length&&
  new Set(app.lines.map(l=>l.itemCode)).size===app.lines.length&&app.lines.every(line=>{
   const item=assessment.items.find(i=>i.itemCode===line.itemCode),exact=comparisonFraction(line.exact);
   return !!item&&line.code==='item:'+item.itemCode&&line.kind===item.kind&&comparisonDecimal(line.amount)===comparisonDecimal(item.amount)&&
    !!exact&&same(line.exact,evidence(decimal(item.amount)))&&line.from===item.from&&line.to===item.to&&Array.isArray(line.sourceRefs)&&line.sourceRefs.length>0&&line.sourceRefs.every(token)&&
    line.recipe===(line.kind==='earning'?'fixed-taxable-earning':'fixed-posttax-deduction')&&comparisonDecimal(line.appliedAmount)!==null;
  });
 let fullGross=totalExact;
 if(itemValid&&app&&totalExact&&n&&validRounding(n.rounding)){
  const earn=app.lines.filter(l=>l.kind==='earning'),deduct=app.lines.filter(l=>l.kind==='deduction');
  itemValid=same(app.earningsExact,evidence(sum(earn.map(l=>decimal(l.amount)))))&&same(app.deductionsExact,evidence(sum(deduct.map(l=>decimal(l.amount)))));
  let cursor=totalExact,prior=rounded(cursor,n.rounding);
  for(const line of earn){cursor=add(cursor,decimal(line.amount));const next=rounded(cursor,n.rounding);if(!same(evidence(decimal(line.appliedAmount!)),evidence(add(decimal(next),mul(decimal(prior),rational(-1n))))))itemValid=false;prior=next;}
  fullGross=cursor;
  if(!same(app.grossExact,evidence(cursor))||!same(comparisonDecimal(app.earningsAmount)!==null?evidence(decimal(app.earningsAmount!)):null,evidence(add(decimal(prior),mul(decimal(rounded(totalExact,n.rounding)),rational(-1n))))))itemValid=false;
 }else if(app)itemValid=false;
 let allocationValid=false;
 if(n&&validRounding(n.rounding)&&n.rounding.stage==='final'&&normalExact&&otExact&&totalExact){
  const normalAmount=rounded(normalExact,n.rounding),beforeComp=rounded(add(normalExact,otExact),n.rounding),grossAmount=rounded(totalExact,n.rounding);
  const expectedOT=evidence(add(decimal(beforeComp),mul(decimal(normalAmount),rational(-1n))));
  const expectedComp=evidence(add(decimal(grossAmount),mul(decimal(beforeComp),rational(-1n))));
  const expectedGross=app?(itemValid&&fullGross?rounded(fullGross,n.rounding):null):grossAmount;
  allocationValid=comparisonDecimal(normalAmount)===numberAmount(s.baseSalary)&&expectedGross!==null&&comparisonDecimal(expectedGross)===numberAmount(s.grossSalary)&&comparisonDecimal(grossAmount)===comparisonDecimal(c?.amount)&&same(expectedOT,numberAmount(s.overtimePay)===null?null:evidence(decimal(String(s.overtimePay))))&&same(expectedComp,numberAmount(s.compSettlementPay)===null?null:evidence(decimal(String(s.compSettlementPay))));
 }
 if(!allocationValid)issues.push('薪資正常／加班／補休分配與既有最終進位規則不一致或尚未核定');
 const normalReady=!!n&&n.employeeId===s.empId&&n.month===s.yearMonth&&n.status==='ready'&&!n.issues.length&&c?.status==='ready'&&!c.issues.length&&allocationValid;
 addLine('normal','earning',c?.normalExact,s.baseSalary,normalReady,payroll,n?.issues||[]);
 const ot=n?.overtimePreview;
 addLine('overtime','earning',c?.overtimeExact,s.overtimePay,normalReady&&ot?.status==='candidate'&&!(ot.blocking?.length),payroll,ot?.blocking||[]);
 const comp=n?.compSettlement;
 const compValues=comp?.items.map(i=>comparisonFraction(i.exact));
 const compConsistent=!!comp&&!!compValues&&compValues.every(v=>!!v)&&same(comp.exact,evidence(sum(compValues.filter(v=>!!v))))&&same(c?.compSettlementExact||zero,comp.exact);
 addLine('comp-settlement','earning',comp?.exact,s.compSettlementPay,normalReady&&compConsistent&&!comp?.issues.length,payroll,comp?.issues||[]);
 if(s.leaveDeduction!==0)issues.push('主檔正常薪資已含假別效果，額外假別扣款來源須核對');
 if(!same(c?.normalExact,n?.exactTotal))issues.push('正常薪資精確合計與來源不一致');
 const normalParts=n?.segments.map(part=>comparisonFraction(part.exact));
 if(!normalParts||normalParts.some(v=>!v)||!same(n?.exactTotal,evidence(sum(normalParts.filter(v=>!!v)))))issues.push('正常薪資分段來源合計不一致');
 const overtimeParts=ot?.lines.filter(line=>line.kind!=='comp-converted').map(line=>comparisonFraction(line.exact));
 if(!overtimeParts||overtimeParts.some(v=>!v)||!same(c?.overtimeExact,ot?.monthExact)||!same(ot?.monthExact,evidence(sum(overtimeParts.filter(v=>!!v)))))issues.push('加班分段與當月精確合計不一致');
 const parts=[c?.normalExact,c?.overtimeExact,comp?.exact].map(comparisonFraction);
 if(parts.some(v=>!v)||!same(c?.exactTotal,evidence(sum(parts.filter(v=>!!v)))))issues.push('應發精確來源合計不一致');
 if(c?.amount==null||(!app&&comparisonDecimal(c.amount)!==numberAmount(s.grossSalary)))issues.push('應發進位結果與薪資金額不一致');

 const ins=s.insuranceDetail,insLines=Array.isArray(ins?.lines)?ins.lines:[];
 const lineRoundingValid=(line:typeof insLines[number])=>{
  const exact=comparisonFraction(line.exact);
  if(!exact||exact.n<0n||!Number.isSafeInteger(line.amount)||line.amount<0)return false;
  // insuranceForMonth already rounds each person's health premium before
  // multiplying dependants and exposes that integer as health.exact. Its other
  // lines retain pre-rounding fractions and round each line to yuan half-up.
  // Check that producer contract without recomputing rates or rounding totals.
  if(line.item==='health')return exact.d===1n&&exact.n===BigInt(line.amount);
  const whole=exact.n/exact.d,remainder=exact.n%exact.d;
  return whole+(remainder*2n>=exact.d?1n:0n)===BigInt(line.amount);
 };
 const insuranceReady=!!insurance.length&&ins?.status==='ready'&&Array.isArray(ins.lines)&&!ins.issues.length&&insLines.every(l=>['labor','employment','health','pension-self'].includes(l.item)&&lineRoundingValid(l));
 const sums=new Map<string,number>();
 for(const code of ['labor','employment','health','pension-self']){
  const selected=insLines.filter(l=>l.item===code),values=selected.map(l=>comparisonFraction(l.exact));
  const amount=selected.reduce((v,l)=>v+l.amount,0);sums.set(code,amount);
  // A missing category is zero only within a complete ready result whose explicit
  // aggregates reconcile below; an absent insurance result is never a zero.
  addLine('insurance:'+code,'deduction',insuranceReady?evidence(sum(values.filter(v=>!!v))):null,amount,insuranceReady,[...payroll,...insurance],ins?.issues||[]);
 }
 if(!insuranceReady||sums.get('labor')!+sums.get('employment')! !==ins?.labor||sums.get('health')!==ins?.health||sums.get('pension-self')!==ins?.pensionSelf||ins?.labor!==s.laborInsurance||ins?.health!==s.healthInsurance||ins?.pensionSelf!==s.laborPensionSelf)issues.push('投保版本、法定逐項進位或保費合計未核對');
 const withholding=s.withholdingDetail;
 for(const [code,key] of [['tax:income','incomeTax'],['health:supplementary','supplementaryPremium']] as const){
  const amount=numberAmount(withholding?.[key]),ready=!!withholding&&withholding.status==='ready'&&!withholding.issues.length&&!!insurance.length&&amount!==null&&amount===numberAmount(s[key]);
  addLine(code,'deduction',ready?evidence(decimal(amount!)):null,s[key],ready,[...payroll,...insurance],withholding?.issues||[]);
 }

 if(itemValid&&app&&fullGross&&n&&validRounding(n.rounding)){
  const statutory=lines.filter(l=>l.kind==='deduction');
  if(statutory.some(l=>l.amount===null))itemValid=false;
  else{
   let cursor=add(fullGross,mul(sum(statutory.map(l=>decimal(l.amount!))),rational(-1n))),prior=rounded(cursor,n.rounding);const before=prior;
   for(const line of app.lines.filter(l=>l.kind==='deduction')){cursor=add(cursor,mul(decimal(line.amount),rational(-1n)));const next=rounded(cursor,n.rounding);if(cursor.n<0n||!same(evidence(decimal(line.appliedAmount!)),evidence(add(decimal(prior),mul(decimal(next),rational(-1n))))))itemValid=false;prior=next;}
   if(cursor.n<0n||comparisonDecimal(prior)!==numberAmount(s.netSalary)||!same(comparisonDecimal(app.deductionsAmount)!==null?evidence(decimal(app.deductionsAmount!)):null,evidence(add(decimal(before),mul(decimal(prior),rational(-1n))))))itemValid=false;
  }
 }
 const inventoryStatus=inventoryBound?(itemValid?'applied-fixed-items':assessment.status):inv?'unreviewed':'missing';
 if(!inventoryBound||assessment.status!=='confirmed-none'&&!itemValid)issues.push(...(assessment.issues.length?assessment.issues:['薪資項目清冊版本或範圍未核對']));
 if(app&&!itemValid)issues.push('額外項目來源、精確金額或累積分配與薪資合計不一致');
 if(itemValid&&app){
  const executionRef={kind:'payroll-item-execution',id:app.source!.id,version:app.source!.evidenceVersion};
  for(const line of app.lines){const projected=addLine(line.code,line.kind,line.exact,line.appliedAmount,true,[...payroll,...itemRefs,executionRef],[]);projected.recordedAmount=line.amount;}
 }else if(inventoryBound)for(const item of assessment.items)lines.push({code:'item:'+item.itemCode,kind:item.kind,status:'unclassified',exact:null,amount:null,recordedAmount:item.amount,sourceRefs:itemRefs,issues:['記錄金額尚未完成法定分類，不得採用到薪資']});
 const gross=numberAmount(s.grossSalary),deductions=numberAmount(s.totalDeductions),net=numberAmount(s.netSalary);
 const earned=lines.filter(l=>l.kind==='earning'),deducted=lines.filter(l=>l.kind==='deduction');
 const lineSum=(rows:PayrollComparisonLine[])=>rows.every(l=>l.amount!==null)?evidence(sum(rows.map(l=>decimal(l.amount!)))):null;
 if(gross===null||deductions===null||net===null||!same(lineSum(earned),gross===null?null:evidence(decimal(gross)))||!same(lineSum(deducted),deductions===null?null:evidence(decimal(deductions)))||!same(net===null?null:evidence(decimal(net)),gross===null||deductions===null?null:evidence(add(decimal(gross),mul(decimal(deductions),rational(-1n))))))issues.push('比較明細與應發／扣項／實發合計不一致或未核定');
 const unique=[...new Set(issues)],complete=!unique.length;
 const p=n?.rounding,rounding=validRounding(p)?{version:p.version,status:p.status,approvedBy:p.approvedBy,approvedAt:p.approvedAt,stage:p.stage,precision:p.precision,mode:p.mode}:null;
 const result:Omit<PayrollComparisonSource,'sourceHash'>={schemaVersion:'payroll-comparison-source-v1',empId:s.empId,month:s.yearMonth,calculationVersion:s.calculationVersion||null,status:complete?'comparable':'needs-review',sources,lines,totals:{gross:complete?gross:null,deductions:complete?deductions:null,net:complete?net:null},inventoryStatus,rounding,issues:unique,formalEligibility:'BLOCKED',applicationStatus:'not-applied',paymentStatus:'not-paid'};
 return {...result,sourceHash:evidenceHash(result)};
}
