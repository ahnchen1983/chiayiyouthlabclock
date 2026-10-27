import table from './data/withholding-2026.json';

/** MOF explanation paragraph (3), not extrapolated printed salary bands.
 * The annual rate differences are derived from the published 115 brackets. */
export const withholdingFormula2026Source = {
 issuedOn:'2025-12-04', issuanceReference:'台財稅字第11404675280號',
 explanationIndexUrl:'https://www.ntbca.gov.tw/singlehtml/a15c33c827e4470c9263930ab2087812?cntId=822c27718d4c4cb8beaf536773e81dca',
 annualRatesUrl:'https://service.mof.gov.tw/public/Data/statistic/Year_Fin/114%E9%9B%BB%E5%AD%90%E6%9B%B8/htm/312020.pdf',
 annualRatesAsOf:'2026-05-31',
} as const;

export interface WithholdingTable2026Input {
 month:unknown;
 taxableSalary:unknown;
 spouseAndDependantsCount:unknown;
 countConfirmed:unknown;
}
export interface WithholdingTable2026Result {
 status:'ready'|'needs-review';
 incomeTax:number|null;
 tableVersion:string;
 issues:string[];
 calculationMethod?:'published-table'|'official-extension-exact';
 formulaSource?:typeof withholdingFormula2026Source;
}

/** Published integer bands, or the official out-of-table formula when exact.
 * This does not establish taxable-income
 * classification, employee election, payment scope, or declaration evidence.
 * The caller must obtain the confirmed count from its reviewed source. */
export function lookupWithholding2026(input:WithholdingTable2026Input):WithholdingTable2026Result {
 const issues:string[]=[];
 const month=input?.month,salary=input?.taxableSalary,count=input?.spouseAndDependantsCount;
 if(typeof month!=='string'||!/^2026-(0[1-9]|1[0-2])$/.test(month))issues.push('withholding-table-month-outside-2026');
 if(typeof salary!=='number'||!Number.isSafeInteger(salary))issues.push('withholding-table-exact-integer-salary-required');
 else if(salary<0)issues.push('withholding-table-salary-outside-printed-bands');
 if(input?.countConfirmed!==true)issues.push('withholding-table-count-unconfirmed');
 if(typeof count!=='number'||!Number.isSafeInteger(count)||count<0)issues.push('withholding-table-count-invalid');
 const held=():WithholdingTable2026Result=>({status:'needs-review',incomeTax:null,tableVersion:table.tableVersion,issues});
 if(issues.length)return held();
 if((salary as number)>table.scope.maximumPrintedSalary||(count as number)>table.scope.maximumCount){
  const annualSalary=BigInt(salary as number)*12n;
  const taxable=annualSalary-101000n*(1n+BigInt(count as number))-272000n-(annualSalary<227000n?annualSalary:227000n);
  // Do not manufacture a zero by clamping an unsupported negative tax base.
  if(taxable<0n){issues.push('withholding-formula-negative-tax-base-unresolved');return held();}
  const [rate,difference]=taxable<=610000n?[5n,0n]:taxable<=1380000n?[12n,42700n]:taxable<=2770000n?[20n,153100n]:taxable<=5190000n?[30n,430100n]:[40n,949100n];
  const numerator=taxable*rate-difference*100n;
  // Keep exact annual arithmetic through division by twelve. Final fractional
  // tax rounding and its order relative to the 2000 exemption remain unresolved.
  if(numerator%1200n!==0n){issues.push('withholding-formula-fractional-tax-rounding-unresolved');return held();}
  const tax=numerator/1200n;
  if(tax<0n||tax>BigInt(Number.MAX_SAFE_INTEGER)){issues.push('withholding-formula-tax-outside-safe-range');return held();}
  return {status:'ready',incomeTax:tax<=2000n?0:Number(tax),tableVersion:table.tableVersion,issues:[],calculationMethod:'official-extension-exact',formulaSource:withholdingFormula2026Source};
 }
 if((salary as number)<table.scope.minimumPrintedSalary){issues.push('withholding-table-salary-outside-printed-bands');return held();}
 // No rounding, interpolation, extrapolation, or default-to-zero is permitted.
 const row=table.rows.find(row=>(salary as number)>=row[0]&&(salary as number)<=row[1]);
 const tax=row?.[2+(count as number)];
 if(!row||row.length!==14||typeof tax!=='number'||!Number.isSafeInteger(tax)||tax<0){
  issues.push('withholding-table-cell-unavailable');return held();
 }
 return {status:'ready',incomeTax:tax,tableVersion:table.tableVersion,issues:[],calculationMethod:'published-table'};
}
