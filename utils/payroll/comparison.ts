import {add,decimal,evidence,mul,rational,type FractionEvidence,type Rational} from './rational';

/** Comparison evidence never authorises adoption, legal treatment or payment. */
export interface PayrollComparisonSourceRef {kind:string;id:string;version:string}
export interface PayrollComparisonLine {
 code:string;
 kind:'earning'|'deduction';
 status:'confirmed'|'needs-review'|'unclassified';
 exact:FractionEvidence|null;
 amount:string|null;
 recordedAmount?:string;
 sourceRefs:PayrollComparisonSourceRef[];
 issues:string[];
}
export interface PayrollComparisonSource {
 schemaVersion:'payroll-comparison-source-v1';
 empId:string;
 month:string;
 calculationVersion:string|null;
 sourceHash:string;
 status:'comparable'|'needs-review';
 sources:PayrollComparisonSourceRef[];
 lines:PayrollComparisonLine[];
 totals:{gross:string|null;deductions:string|null;net:string|null};
 inventoryStatus:string;
 rounding:unknown;
 issues:string[];
 formalEligibility:'BLOCKED';
 applicationStatus:'not-applied';
 paymentStatus:'not-paid';
}
export function comparisonDecimal(value:unknown):string|null {
 if(typeof value!=='string'||!/^(0|[1-9]\d{0,11})(\.\d{1,8})?$/.test(value))return null;
 const [whole,part='']=value.split('.'),fraction=part.replace(/0+$/,'');
 return fraction?whole+'.'+fraction:whole;
}
export function comparisonFraction(value:any):Rational|null {
 if(typeof value?.numerator!=='string'||typeof value?.denominator!=='string'||! /^-?\d{1,80}$/.test(value.numerator)||! /^\d{1,80}$/.test(value.denominator))return null;
 try{return BigInt(value.denominator)>0n?rational(BigInt(value.numerator),BigInt(value.denominator)):null;}catch{return null;}
}
/** Delta direction is manual minus system. Unknown is never a zero difference. */
export function comparePayrollAmounts(manual:unknown,system:unknown):{status:'comparable'|'unresolved';delta:FractionEvidence|null} {
 const a=comparisonDecimal(manual),b=comparisonDecimal(system);
 if(a===null||b===null)return {status:'unresolved',delta:null};
 return {status:'comparable',delta:evidence(add(decimal(a),mul(decimal(b),rational(-1n))))};
}
