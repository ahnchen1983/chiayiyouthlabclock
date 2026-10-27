import {describe,it,expect} from 'vitest';
import {validatePaymentEvidence,assessPaymentEvidence} from '../utils/payroll/paymentEvidence';
const event=(extra:any={})=>({id:'PAY-1',evidenceLocator:'ROW-1',paidOn:'2026-09-05',amount:'30000',sourceRefs:['PAYMENT-1'],reason:'Synthetic actual payment',incomeClassification:'salary-monthly',insuredCategory:'insured-here',exemption:null,...extra});
const inventory=(events:any[]=[event()])=>({empId:'synthetic@example.test',month:'2026-08',mode:events.length?'events':'none',sourceRefs:['MONTH-SOURCE'],reason:'Synthetic complete payment inventory',events});
const context=(extra:any={})=>({empId:'synthetic@example.test',month:'2026-08',monthlyPayable:'30000',payableSourceRef:'PAYABLE-1',...extra});
describe('payment evidence recording and exact reconciliation only',()=>{
 it('records actual next-month payment without converting it into the accrual month',()=>{
  const value=validatePaymentEvidence(inventory());expect(value.events[0].paidOn).toBe('2026-09-05');
  expect(assessPaymentEvidence(value,context())).toMatchObject({status:'ready-evidence',totalRecorded:'30000',formalEligibility:'BLOCKED',legalValidation:'unresolved',incomeTaxBase:null,pensionBasis:null});
 });
 it('reconciles multiple actual events exactly without inventing splits',()=>{
  const value=inventory([event({amount:'0.10'}),event({id:'PAY-2',evidenceLocator:'ROW-2',sourceRefs:['PAYMENT-2'],amount:'0.20'})]);
  expect(assessPaymentEvidence(value,context({monthlyPayable:'0.30'}))).toMatchObject({status:'ready-evidence',totalRecorded:'0.3'});
 });
 it('distinguishes explicit none/zero from missing inventory or payable',()=>{
  expect(assessPaymentEvidence(inventory([]),context({monthlyPayable:'0'})).status).toBe('ready-evidence');
  expect(assessPaymentEvidence(inventory([event({amount:'0.00'})]),context({monthlyPayable:'0'})).totalRecorded).toBe('0');
  expect(assessPaymentEvidence(null,context()).status).toBe('needs-review');
  expect(assessPaymentEvidence(inventory(),context({monthlyPayable:null})).status).toBe('needs-review');
 });
 it('retains category2 union proof with issuer and prior receipt evidence without computing or imposing any deduction',()=>{
  const value=inventory([event({insuredCategory:'category-2-union',exemption:{kind:'category-2-union',from:'2026-01-01',to:'2026-12-31',sourceRefs:['PROOF-1'],issuerRef:'UNION-1',proofKind:'insurance-unit-certificate',providedAt:'2026-09-04T10:00:00+08:00'}})]);
  const result=assessPaymentEvidence(value,context());expect(result.status).toBe('ready-evidence');
  expect(result).not.toHaveProperty('supplementaryPremium');expect(result).not.toHaveProperty('incomeTax');expect(result.legalValidation).toBe('unresolved');
 });
 it.each([
  event({incomeClassification:'unresolved'}),event({incomeClassification:'non-salary'}),event({insuredCategory:'unresolved'}),
  event({insuredCategory:'other',exemption:null}),event({insuredCategory:'category-2-union',exemption:null}),
  event({insuredCategory:'category-2-union',exemption:{kind:'category-2-union',from:'2026-01-01',to:'2026-08-31',sourceRefs:['PROOF-1']}}),
 ])('holds unresolved applicability or proof outside actual payment date',row=>{expect(assessPaymentEvidence(inventory([row]),context()).status).toBe('needs-review');});
 it.each([{monthlyPayable:'30001'},{payableSourceRef:null},{empId:'OTHER'},{month:'2026-09'}])('holds reconciliation or bound-source gaps: %j',extra=>{expect(assessPaymentEvidence(inventory(),context(extra)).status).toBe('needs-review');});
 it.each(['-1','1e4','01','1.001',30000,null])('rejects noncanonical/negative amounts: %j',amount=>{expect(()=>validatePaymentEvidence(inventory([event({amount})]))).toThrow();});
 it('rejects duplicate event identities and identical source locators case-insensitively',()=>{
  expect(()=>validatePaymentEvidence(inventory([event(),event({id:'pay-1',sourceRefs:['SECOND']})]))).toThrow();
  expect(()=>validatePaymentEvidence(inventory([event(),event({id:'PAY-2',sourceRefs:['payment-1']})]))).toThrow();
 });
 it('allows one statement to substantiate distinct actual payment rows',()=>{
  expect(()=>validatePaymentEvidence(inventory([event(),event({id:'PAY-2',evidenceLocator:'ROW-2'})]))).not.toThrow();
 });
 it('rejects unknown server fields, executable values and raw source URLs',()=>{
  expect(()=>validatePaymentEvidence({...inventory(),approvedBy:'ADMIN'})).toThrow();
  expect(()=>validatePaymentEvidence(inventory([event({formula:'gross*0.05'})]))).toThrow();
  expect(()=>validatePaymentEvidence(inventory([event({sourceRefs:['https://example.test/proof']})]))).toThrow();
 });
 it('rejects impossible payment dates and unsubstantiated exemption records',()=>{
  expect(()=>validatePaymentEvidence(inventory([event({paidOn:'2026-02-30'})]))).toThrow();
  expect(()=>validatePaymentEvidence(inventory([event({exemption:{kind:'category-2-union',from:'2026-01-01',to:'2026-12-31',sourceRefs:[]}})]))).toThrow();
 });
});


describe('union proof provenance and pre-payment timing',()=>{
 const proof=(extra:any={})=>({kind:'category-2-union',from:'2026-01-01',to:'2026-12-31',sourceRefs:['PROOF-1'],issuerRef:'UNION-1',proofKind:'insurance-unit-certificate',providedAt:'2026-09-04T10:00:00+08:00',...extra});
 const assess=(p:any,e:any={})=>assessPaymentEvidence(inventory([event({insuredCategory:'category-2-union',exemption:p,...e})]),context());
 it.each([{issuerRef:undefined},{proofKind:undefined},{providedAt:undefined},{providedAt:'2026-09-05T08:00:00+08:00'},{providedAt:'2026-09-06T08:00:00+08:00'}])('retains incomplete timing or issuer evidence without claiming readiness: %j',extra=>{expect(assess(proof(extra)).status).toBe('needs-review');});
 it('requires strict ordering when actual payment time is explicitly known',()=>{
  expect(assess(proof({providedAt:'2026-09-05T08:00:00+08:00'}),{paidAt:'2026-09-05T09:00:00+08:00'}).status).toBe('ready-evidence');
  expect(assess(proof({providedAt:'2026-09-05T09:00:00+08:00'}),{paidAt:'2026-09-05T09:00:00+08:00'}).status).toBe('needs-review');
 });
 it('compares Taipei dates rather than lexical UTC dates',()=>{expect(assess(proof({providedAt:'2026-09-04T23:00:00Z'})).status).toBe('needs-review');});
 it('holds query-route expiry until exact calendar validity can be established',()=>{expect(assess(proof({proofKind:'insurer-query',queriedAt:'2026-08-01T09:00:00+08:00'})).issues).toContain('insurer-query-validity-unresolved:PAY-1');});
 it.each([{paidAt:'2026-09-04T23:00:00+08:00'},{paidAt:'2026-09-05T25:00:00+08:00'},{paidAt:'2026-02-30T09:00:00+08:00'}])('rejects invalid actual timestamp or mismatched payment date',extra=>{expect(()=>validatePaymentEvidence(inventory([event(extra)]))).toThrow();});
 it.each([{providedAt:'2026-02-30T08:00:00+08:00'},{providedAt:'2026-09-04'},{issuerRef:'https://example.test/proof'},{proofKind:'automatic-exemption'}])('rejects malformed supplied proof metadata',extra=>{expect(()=>validatePaymentEvidence(inventory([event({exemption:proof(extra)})]))).toThrow();});
});

describe('explicit insurer confirmation reply date validity',()=>{
 const query=(queryConfirmedOn?:string,extra:any={})=>({kind:'category-2-union',from:'2025-01-01',to:'2027-12-31',sourceRefs:['INSURER-REPLY-1'],issuerRef:'NHI',proofKind:'insurer-query',providedAt:'2025-01-01T09:00:00+08:00',...(queryConfirmedOn?{queryConfirmedOn}:{}),...extra});
 const assessQuery=(reply:string|undefined,paidOn:string,extra:any={})=>assessPaymentEvidence(inventory([event({paidOn,insuredCategory:'category-2-union',exemption:query(reply,extra)})]),context());
 it.each([['2026-02-28','2026-04-27'],['2026-06-01','2026-07-31'],['2026-08-05','2026-10-04'],['2026-11-15','2027-01-14'],['2026-08-05','2026-08-05']])('accepts ordinary date interval anchored at reply %s through payment %s', (reply,paid)=>{expect(assessQuery(reply,paid).status).toBe('ready-evidence');});
 it.each([['2026-02-28','2026-04-28'],['2026-08-05','2026-10-05'],['2026-08-05','2026-08-04']])('holds payment %s outside explicit reply interval %s',(reply,paid)=>{expect(assessQuery(reply,paid).issues).toContain('insurer-query-outside-validity:PAY-1');});
 it.each(['2025-12-31','2026-07-31','2026-12-29'])('does not clamp absent corresponding dates or substitute sixty days: %s',reply=>{expect(assessQuery(reply,reply).issues).toContain('insurer-query-month-end-boundary-unresolved:PAY-1');});
 it('never infers the reply date from legacy request time and preserves its existing issue',()=>{const proof=query(undefined,{queriedAt:'2026-08-01T09:00:00+08:00'});const v=validatePaymentEvidence(inventory([event({insuredCategory:'category-2-union',exemption:proof})]));expect(v.events[0].exemption).not.toHaveProperty('queryConfirmedOn');expect(assessPaymentEvidence(v,context()).issues).toEqual(['insurer-query-validity-unresolved:PAY-1']);});
 it('does not bypass original proof source, applicability or provision ordering',()=>{
  expect(assessQuery('2026-08-05','2026-09-05',{providedAt:'2026-09-06T09:00:00+08:00'}).issues).toContain('union-proof-prepayment-timing-unresolved:PAY-1');
  expect(assessQuery('2026-08-05','2026-09-05',{to:'2026-08-31'}).status).toBe('needs-review');
  expect(()=>validatePaymentEvidence(inventory([event({insuredCategory:'category-2-union',exemption:query('2026-08-05',{sourceRefs:[]})})]))).toThrow();
 });
 it.each(['2026-02-29','2026-8-5','2026-08-05T00:00:00Z','',null])('rejects malformed supplied reply date %j',queryConfirmedOn=>{expect(()=>validatePaymentEvidence(inventory([event({insuredCategory:'category-2-union',exemption:{...query(),queryConfirmedOn}})]))).toThrow();});
 it('rejects reply date attached to a different proof kind',()=>{expect(()=>validatePaymentEvidence(inventory([event({exemption:query('2026-08-05',{proofKind:'insurance-unit-certificate'})})]))).toThrow();});
});
