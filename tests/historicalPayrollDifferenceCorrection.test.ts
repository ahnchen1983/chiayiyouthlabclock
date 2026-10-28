vi.mock('../netlify/functions/utils/historicalPayrollCorrection',()=>({loadApprovedHistoricalPayrollCorrection:vi.fn()}));
import {loadApprovedHistoricalPayrollCorrection} from '../netlify/functions/utils/historicalPayrollCorrection';
import {loadReviewedHistoricalPayrollDifferenceForAdjustment} from '../netlify/functions/utils/historicalPayrollDifference';
import {beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('../netlify/functions/utils/payrollSourceReader',()=>({loadPayrollMonthSource:vi.fn()}));
import {loadPayrollMonthSource} from '../netlify/functions/utils/payrollSourceReader';
import {handleHistoricalPayrollDifferenceAction as handle} from '../netlify/functions/utils/historicalPayrollDifference';
import {UserRole} from '../types';
import {evidenceHash} from '../netlify/functions/utils/attendanceCaseLifecycle';

const empId='SYNTH',month='2026-08',clone=(v:any):any=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const data=new Map<string,any>(),writes:string[]=[];
const doc=(path:string):any=>({path});
const db:any={collection:(name:string)=>({doc:(id:string)=>doc(name+'/'+id)}),async runTransaction(fn:any){
 const pending:any[]=[];let wrote=false;
 const tx:any={async get(ref:any){if(wrote)throw Error('read-after-write');return {exists:data.has(ref.path),data:()=>clone(data.get(ref.path))};}};
 for(const mode of ['create','set'])tx[mode]=(ref:any,value:any)=>{wrote=true;pending.push({mode,path:ref.path,value:clone(value)});};
 const result=await fn(tx);for(const p of pending)if(p.mode==='create'&&data.has(p.path))throw Error('exists');
 for(const p of pending){data.set(p.path,p.value);writes.push(p.path);}return result;
}};
let loaded:any,sequence=0;
const salary=()=>({empId,yearMonth:month,calculationStatus:'locked',calculationVersion:'synthetic-old',baseSalary:1000,overtimePay:0,compSettlementPay:0,laborInsurance:0,healthInsurance:100,laborPensionSelf:0,leaveDeduction:0,incomeTax:0,supplementaryPremium:0,grossSalary:1000,totalDeductions:100,netSalary:900});
const codes=[['normal','earning','1000'],['overtime','earning','0'],['comp-settlement','earning','0'],['insurance:labor-employment','deduction','0'],['insurance:health','deduction','100'],['pension:self','deduction','0'],['leave','deduction','0'],['tax:income','deduction','0'],['health:supplementary','deduction','0']];
const actual=()=>({currency:'TWD',items:codes.map(([sourceCode,kind,amount])=>({sourceCode,kind,amount,sourceRefs:['SYNTHETIC-LINE'],reason:'Synthetic recorded item evidence'})),netAmount:'900',sourceRefs:['SYNTHETIC-NET'],reason:'Synthetic recorded payment evidence'});
const command=(extra:any={})=>({empId,month,expectedRevision:0,operationId:'op-'+(++sequence),reason:'Synthetic independent historical evidence',...extra});
const propose=(extra:any={},uid='A1')=>handle(db,uid,'propose-historical-payroll-difference',command({actual:actual(),...extra}));
const review=(p:any,extra:any={},uid='A2')=>handle(db,uid,'review-historical-payroll-difference',command({expectedRevision:p.revision,mode:'approve',...extra}));
const adopt=(p:any,extra:any={},uid='A2')=>handle(db,uid,'adopt-historical-payroll-difference',command({expectedRevision:p.revision,...extra}));
beforeEach(()=>{
 data.clear();writes.length=0;sequence=0;
 for(const id of ['A1','A2','A3'])data.set('employees/'+id,{role:UserRole.SuperAdmin});data.set('employees/'+empId,{role:UserRole.Employee});
 const lock={yearMonth:month,payrollRunId:'SYNTH-RUN',lockedBy:'A3',lockedAt:'2026-09-01T00:00:00Z'},s=salary(),run={id:'SYNTH-RUN',yearMonth:month,calculationVersion:'synthetic-old',inputHash:'input-hash',inputs:{employees:[],records:[],leaves:[],schedules:[]},salaries:[s]};
 data.set('monthLocks/'+month,clone(lock));data.set('payrollRuns/SYNTH-RUN',clone(run));
 loaded={kind:'locked',run,lock,salaries:[s],originalInputHash:'input-hash',sourceHash:'source-hash',completeness:'complete'};
 vi.mocked(loadPayrollMonthSource).mockReset().mockImplementation(async(_db,reader)=>{expect(reader.get).toBeTypeOf('function');return clone(loaded);});
});

const correctionRef={id:'synthetic-correction',revision:3,evidenceVersion:evidenceHash('adopted-correction'),calculatorVersion:'synthetic-calculator',adapterVersion:'historical-rate-correction-v1'};
let correction:any;
beforeEach(async()=>{
 data.set('employees/C1',{role:UserRole.SuperAdmin});
 const preview=await handle(db,'A1','get-historical-payroll-difference',{empId,month}),source=clone(preview.source),bundleHash=evidenceHash('synthetic-correction-bundle');
 source.lines.find((l:any)=>l.code==='normal').amount='1100';source.lines.find((l:any)=>l.code==='normal').exact={numerator:'1100',denominator:'1'};
 source.totals.gross='1100';source.totals.net='1000';source.sources=[{kind:'payroll-inputs',id:empId,version:bundleHash}];delete source.sourceHash;source.sourceHash=evidenceHash(source);
 const original={runId:loaded.run.id,inputHash:loaded.originalInputHash,sourceHash:loaded.sourceHash,runHash:evidenceHash(loaded.run),lockHash:evidenceHash(loaded.lock),salaryHash:evidenceHash(loaded.salaries[0])};
 correction={correctionRef,source,original,authors:['C1'],binding:{scope:'historical-corrected-rate',correctionRef,original,bundleHash}};
 vi.mocked(loadApprovedHistoricalPayrollCorrection).mockReset().mockImplementation(async(_db,_reader,args)=>{if(evidenceHash(args.correctionRef)!==evidenceHash(correctionRef))throw Object.assign(Error('stale correction'),{statusCode:409});return clone(correction);});
});
describe('historical D optional approved correction basis',()=>{
 it('preserves original default while explicit reference previews corrected source',async()=>{const original=await handle(db,'A1','get-historical-payroll-difference',{empId,month}),corrected=await handle(db,'A1','get-historical-payroll-difference',{empId,month,correctionRef});expect(original.comparisonBasis).toBe('original-recorded-payroll');expect(original.source.totals.net).toBe('900');expect(corrected.comparisonBasis).toBe('corrected-historical-rate');expect(corrected.source.totals.net).toBe('1000');expect(corrected.original).toEqual(original.original);expect(corrected.sourceAuthors).toEqual(['C1']);});
 it('reviews nonzero corrected comparison and supplies bound target to adjustment loader',async()=>{const before=clone([data.get('payrollRuns/SYNTH-RUN'),data.get('monthLocks/'+month)]),p=await propose({correctionRef});expect(p.comparisonBasis).toBe('corrected-historical-rate');expect(p.comparison.varianceStatus).toBe('nonzero');await expect(review(p,{},'C1')).rejects.toMatchObject({statusCode:403});const r=await review(p);await expect(adopt(r)).rejects.toMatchObject({statusCode:409});const result=await db.runTransaction((tx:any)=>loadReviewedHistoricalPayrollDifferenceForAdjustment(db,tx,{empId,month,at:'2026-10-26T00:00:00Z'}));expect(result.source.totals.net).toBe('1000');expect(result.binding.correctionRef).toEqual(correctionRef);expect(result.authors).toEqual(expect.arrayContaining(['A1','C1']));expect([data.get('payrollRuns/SYNTH-RUN'),data.get('monthLocks/'+month)]).toEqual(before);});
 it('checks stored corrected freshness separately from default original preview',async()=>{const p=await propose({correctionRef});const g=await handle(db,'A1','get-historical-payroll-difference',{empId,month});expect(g.comparisonBasis).toBe('original-recorded-payroll');expect(g.stale).toBe(false);vi.mocked(loadApprovedHistoricalPayrollCorrection).mockRejectedValue(Object.assign(Error('superseded'),{statusCode:409}));expect((await handle(db,'A1','get-historical-payroll-difference',{empId,month})).stale).toBe(true);await expect(review(p)).rejects.toMatchObject({statusCode:409});expect((await review(p,{mode:'return'})).status).toBe('returned');});
 it('keeps correction authors excluded after returning to original comparison basis',async()=>{const p=await propose({correctionRef}),returned=await review(p,{mode:'return'}),next=await propose({expectedRevision:returned.revision});await expect(review(next,{},'C1')).rejects.toMatchObject({statusCode:403});expect((await review(next)).status).toBe('reviewed');});
 it('rejects origin substitution and invalid selfhash',async()=>{correction.original.salaryHash='different';await expect(propose({correctionRef})).rejects.toMatchObject({statusCode:409});correction.original.salaryHash=evidenceHash(loaded.salaries[0]);correction.source.totals.net='999';await expect(propose({correctionRef})).rejects.toMatchObject({statusCode:409});});
 it('retains original-mode immutable adoption validity',async()=>{const p=await propose(),r=await review(p),a=await adopt(r);expect(a.correctionRef).toBeUndefined();expect((await handle(db,'A1','get-historical-payroll-difference',{empId,month})).current).toEqual(a);});
});
