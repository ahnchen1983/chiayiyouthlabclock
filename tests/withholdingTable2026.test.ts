import {describe,it,expect} from 'vitest';
import table from '../utils/payroll/data/withholding-2026.json';
import {lookupWithholding2026,withholdingFormula2026Source} from '../utils/payroll/withholdingTable2026';

// Public official table values and synthetic inputs only. No employee data.
const version='tw-mof-salary-withholding-115-11404675280';
const lookup=(taxableSalary:unknown,spouseAndDependantsCount:unknown=0,extra:Record<string,unknown>={})=>
 lookupWithholding2026({month:'2026-08',taxableSalary,spouseAndDependantsCount,countConfirmed:true,...extra} as any);

describe('official 115 withholding table provenance and complete extraction',()=>{
 it('binds the exact official sources, year and publication',()=>{
  expect(table.tableVersion).toBe(version);
  expect(table.year).toBe(2026);expect(table.rocYear).toBe(115);
  expect(table.issuedOn).toBe('2025-12-04');expect(table.issuanceReference).toBe('台財稅字第11404675280號');
  expect(table.source.odsUrl).toBe('https://www.ntbca.gov.tw/download/8a42e9511ba449fe84b5264292a636f7');
  expect(table.source.odsSha256).toBe('9c2aea41d3594e9badea10a999400603a81b9111854f24e4003a4cf0f0394ca9');
  expect(table.source.pdfSha256).toBe('7ec122600e526aa32c0471f5148906cc22123100e742103e0ce3fcdd32af786e');
  expect(table.verification).toEqual({odsBands:840,odsTaxCells:10080,independentPdfComparedBands:840,independentPdfComparedTaxCells:10080,mismatches:0});
 });
 it('retains every printed band and twelve count columns without adding lower bands',()=>{
  expect(table.countColumns).toEqual([0,1,2,3,4,5,6,7,8,9,10,11]);expect(table.rows).toHaveLength(840);
  expect(table.rows[0].slice(0,2)).toEqual([80001,80500]);expect(table.rows.at(-1)?.slice(0,2)).toEqual([499501,500000]);
  // Check every cell with one diagnostic assertion, avoiding tens of thousands
  // of matcher allocations while retaining the complete band/cell coverage.
  const invalid=table.rows.flatMap((row,i)=>{
   const errors:string[]=[];
   if(row.length!==14)errors.push(`row ${i}: columns`);
   if(row[1]-row[0]!==499)errors.push(`row ${i}: width`);
   if(i&&row[0]!==table.rows[i-1][1]+1)errors.push(`row ${i}: continuity`);
   row.slice(2).forEach((value,j)=>{if(!Number.isSafeInteger(value)||value<0)errors.push(`row ${i} column ${j}: value`);});
   return errors;
  });
  expect(invalid).toEqual([]);
 });
});

describe('official 115 out-of-table formula with unresolved rounding held',()=>{
 it.each([[500005,2,94177],[300000,14,13675],[151000,12,0],[191000,12,0],[191020,12,2001]])(
  'salary %s count %s has exact statutory result %s',(salary,count,tax)=>{
   expect(lookup(salary,count)).toMatchObject({status:'ready',incomeTax:tax,calculationMethod:'official-extension-exact',formulaSource:withholdingFormula2026Source});
  });
 it('identifies the dated formula separately from printed cells',()=>{
  expect(withholdingFormula2026Source.issuedOn).toBe('2025-12-04');
  expect(withholdingFormula2026Source.issuanceReference).toBe('台財稅字第11404675280號');
  expect(withholdingFormula2026Source.annualRatesAsOf).toBe('2026-05-31');
  expect(lookup(500000,2)).toMatchObject({calculationMethod:'published-table',incomeTax:93970});
 });
 it.each([[500001,0],[500005,0],[500005,3]])('does not truncate fractional formula tax for %s/%s',(salary,count)=>{
  expect(lookup(salary,count)).toMatchObject({status:'needs-review',incomeTax:null,issues:['withholding-formula-fractional-tax-rounding-unresolved']});
 });
 it('does not clamp a negative annual taxable amount to zero',()=>{
  expect(lookup(100000,12)).toMatchObject({status:'needs-review',issues:['withholding-formula-negative-tax-base-unresolved']});
 });
 it('does not round fractional salary even in the extension',()=>{
  expect(lookup(500005.5,2).status).toBe('needs-review');
 });
 it('requires reviewed count and applicable year for the extension',()=>{
  expect(lookup(500005,2,{countConfirmed:false}).status).toBe('needs-review');
  expect(lookup(500005,2,{month:'2027-08'}).status).toBe('needs-review');
 });
});

describe('bounded lookup of confirmed 2026 monthly salary table evidence',()=>{
 it.each([[80001,0,0],[90500,0,0],[90501,0,2020],[91000,0,2020],[91001,0,2050],
  [99001,0,2450],[99001,1,2020],[99001,2,0],[250001,0,27240],[250001,5,18820],
  [250001,11,9330],[500000,0,100700],[500000,11,71230]])('salary %s, count %s yields published tax %s',(salary,count,tax)=>{
  expect(lookup(salary,count)).toMatchObject({status:'ready',incomeTax:tax,tableVersion:version,issues:[]});
 });
 it.each(['2026-01','2026-08','2026-12'])('accepts valid months of the published year: %s',month=>{
  expect(lookup(90501,0,{month})).toMatchObject({status:'ready',incomeTax:2020});
 });
 it.each([
  ['fractional salary',90500.5,0,{}],['fraction within printed band',91001.25,0,{}],
  ['below printed range',80000,0,{}],['zero salary outside printed range',0,0,{}],['negative salary',-1,0,{}],
  ['above printed range',500001,0,{}],['salary missing',undefined,0,{}],['salary null',null,0,{}],
  ['salary string','90501',0,{}],['salary NaN',NaN,0,{}],['salary infinite',Infinity,0,{}],
  ['salary unsafe integer',Number.MAX_SAFE_INTEGER+1,0,{}],
  ['count missing',90501,undefined,{}],['count null',90501,null,{}],['count string',90501,'0',{}],
  ['count negative',90501,-1,{}],['count fractional',90501,0.5,{}],['count beyond table',90501,12,{}],
  ['count NaN',90501,NaN,{}],['count unconfirmed',90501,0,{countConfirmed:false}],
  ['count confirmation missing',90501,0,{countConfirmed:undefined}],['count confirmation string',90501,0,{countConfirmed:'true'}],
  ['prior year',90501,0,{month:'2025-08'}],['later year',90501,0,{month:'2027-08'}],
  ['invalid month zero',90501,0,{month:'2026-00'}],['invalid month thirteen',90501,0,{month:'2026-13'}],
  ['noncanonical month',90501,0,{month:'2026-8'}],['month missing',90501,0,{month:undefined}],
 ])('holds unresolved input: %s',(_label,salary,count,extra)=>{
  // Pass the count explicitly; no missing-count default may invent a confirmed zero.
  const result=lookupWithholding2026({month:'2026-08',taxableSalary:salary,spouseAndDependantsCount:count,countConfirmed:true,...extra} as any);
  expect(result.status).toBe('needs-review');expect(result.incomeTax).toBeNull();expect(result.issues.length).toBeGreaterThan(0);
 });
});
