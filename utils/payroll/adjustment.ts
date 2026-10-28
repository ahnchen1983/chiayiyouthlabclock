import {add,decimal,mul,rational,sum,type Rational} from './rational';
export interface AdjustmentLine {code:string;kind:'earning'|'deduction';amount:string}
export interface AdjustmentAmounts {lines:AdjustmentLine[];net:string}
/** Decimal money only: never round differences or reinterpret statutory bases. */
export function adjustmentDecimal(value:Rational):string {
 const scale=100000000n,n=value.n*scale;if(n%value.d)throw Error('non-decimal adjustment');
 const v=n/value.d,negative=v<0n,digits=(negative?-v:v).toString().padStart(9,'0');
 return (negative?'-':'')+digits.slice(0,-8)+(digits.slice(-8).replace(/0+$/,'')?'.'+digits.slice(-8).replace(/0+$/,''):'');
}
export function validateAdjustmentAmounts(value:AdjustmentAmounts):AdjustmentAmounts {
 if(!value||!Array.isArray(value.lines)||!value.lines.length||value.lines.length>100||typeof value.net!=='string')throw Error('invalid adjustment amounts');
 const seen=new Set<string>();const lines=value.lines.map(line=>{
  if(!line||typeof line.code!=='string'||!line.code||seen.has(line.code)||!['earning','deduction'].includes(line.kind)||typeof line.amount!=='string')throw Error('invalid adjustment line');seen.add(line.code);
  return {code:line.code,kind:line.kind,amount:adjustmentDecimal(decimal(line.amount))};
 }).sort((a,b)=>a.code.localeCompare(b.code));
 const net=adjustmentDecimal(sum(lines.map(l=>mul(decimal(l.amount),rational(l.kind==='earning'?1n:-1n)))));
 if(net!==adjustmentDecimal(decimal(value.net)))throw Error('adjustment net does not reconcile');return {lines,net};
}
export function projectPayrollAdjustments(baseline:AdjustmentAmounts,target:AdjustmentAmounts,runs:AdjustmentAmounts[]=[]){
 const base=validateAdjustmentAmounts(baseline),goal=validateAdjustmentAmounts(target),deltas=runs.map(validateAdjustmentAmounts);
 const keys=(v:AdjustmentAmounts)=>JSON.stringify(v.lines.map(l=>[l.code,l.kind]));
 if([goal,...deltas].some(v=>keys(v)!==keys(base)))throw Error('adjustment item scope changed');
 const cumulative=validateAdjustmentAmounts({lines:base.lines.map((l,i)=>({...l,amount:adjustmentDecimal(sum(deltas.map(d=>decimal(d.lines[i].amount))))})),net:adjustmentDecimal(sum(deltas.map(d=>decimal(d.net))))});
 const accounted=validateAdjustmentAmounts({lines:base.lines.map((l,i)=>({...l,amount:adjustmentDecimal(add(decimal(l.amount),decimal(cumulative.lines[i].amount)))})),net:adjustmentDecimal(add(decimal(base.net),decimal(cumulative.net)))});
 const outstanding=validateAdjustmentAmounts({lines:goal.lines.map((l,i)=>({...l,amount:adjustmentDecimal(add(decimal(l.amount),mul(decimal(accounted.lines[i].amount),rational(-1n))))})),net:adjustmentDecimal(add(decimal(goal.net),mul(decimal(accounted.net),rational(-1n))))});
 return {baseline:base,recordedActualNet:base.net,cumulativeAdjustments:cumulative,accountedTarget:accounted,target:goal,outstanding,paymentStatus:'not-paid' as const,automaticWageDeduction:false as const};
}
