import {beforeEach,describe,expect,it} from 'vitest';
import {UserRole} from '../types';
import {validatePayrollItemInventory,assessPayrollItemInventory} from '../utils/payroll/items';
import {handlePayrollItemsAction} from '../netlify/functions/utils/payrollItems';

// Synthetic metadata and people only. This workflow does not calculate or pay salary.
const item=(extra:any={})=>({itemCode:'travel-allowance',kind:'earning',amount:'1200.50',from:'2026-08-01',to:'2026-08-31',sourceRefs:['document:DEMO-1:row-1'],reason:'合成津貼來源逐項核對',...extra});
const inventory=(extra:any={})=>({empId:'E1',month:'2026-08',mode:'items',sourceRefs:['inventory:DEMO-202608'],reason:'合成月份項目清冊核對',items:[item()],...extra});
const none=()=>inventory({mode:'none',items:[],reason:'已逐項核對本月無其他給付扣款'});
const status=(fn:()=>any)=>{try{fn();return 0;}catch(e:any){return e.statusCode;}};

describe('payroll item evidence validation',()=>{
 it('normalises exact decimal strings without discarding an explicit zero',()=>{const v=validatePayrollItemInventory(inventory({items:[item({amount:'0.00',reason:'核對證據確認本項金額為零'})]}));expect(v.items[0].amount).toBe('0');expect(validatePayrollItemInventory(inventory()).items[0].amount).toBe('1200.5');});
 it('distinguishes a sourced no-other-items attestation from missing evidence',()=>{expect(validatePayrollItemInventory(none())).toMatchObject({mode:'none',items:[]});expect(assessPayrollItemInventory(null).status).toBe('missing');});
 it.each([
  {mode:'none',items:[item()]},{mode:'items',items:[]},{items:undefined},{sourceRefs:[]},{reason:'短'},
  {month:'2026-13'},{empId:'E/1'},{status:'approved'},{approvedBy:'A2'},{netSalary:100},
 ])('rejects absent, contradictory or client-owned inventory fields %#',extra=>{expect(status(()=>validatePayrollItemInventory(inventory(extra)))).toBe(400);});
 it.each(['-1','+1','1e3','NaN','01','1.234','10000000000','',1,null])('rejects signed, ambiguous or out-of-range fixed amounts %s',amount=>{expect(status(()=>validatePayrollItemInventory(inventory({items:[item({amount})]})))).toBe(400);});
 it.each([
  {kind:'net'},{amount:'0',reason:''},{sourceRefs:[]},{formula:'gross * 0.05'},
  {incomeTaxIncluded:false},{classification:'approved'},{from:'2026-07-31'},{to:'2026-09-01'},
  {from:'2026-08-31',to:'2026-08-01'},{from:'2026-08-32'},
 ])('rejects unreviewable item evidence %#',extra=>{expect(status(()=>validatePayrollItemInventory(inventory({items:[item(extra)]})))).toBe(400);});
 it('rejects duplicate item codes or duplicate source attribution, including case variants',()=>{
  expect(status(()=>validatePayrollItemInventory(inventory({items:[item(),item({sourceRefs:['document:DEMO-2:row-1']})]})))).toBe(400);
  expect(status(()=>validatePayrollItemInventory(inventory({items:[item(),item({itemCode:'another',sourceRefs:['DOCUMENT:demo-1:ROW-1']})]})))).toBe(400);
  expect(status(()=>validatePayrollItemInventory(inventory({sourceRefs:['inventory:A','INVENTORY:a']})))).toBe(400);
 });
 it.each(['https://example.test/private?token=x','../private','document:secret value','document:\nsecret'])('accepts only bounded metadata identifiers: %s',ref=>{expect(status(()=>validatePayrollItemInventory(inventory({sourceRefs:[ref]})))).toBe(400);});
});

const data=new Map<string,any>();
const clone=(x:any)=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const doc=(path:string):any=>({path,id:path.split('/').pop(),async get(){return {id:path.split('/').pop(),exists:data.has(path),data:()=>clone(data.get(path))};}});
const collection=(path:string,filters:any[]=[],limit=Infinity):any=>({doc:(id:string)=>doc(path+'/'+id),where:(f:string,_:string,v:any)=>collection(path,[...filters,[f,v]],limit),limit:(n:number)=>collection(path,filters,n),async get(){const docs=[...data.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===2).map(k=>({id:k.split('/')[1],data:()=>clone(data.get(k))})).filter(d=>filters.every(([f,v])=>d.data()[f]===v)).slice(0,limit);return {docs,size:docs.length};}});
let beforeTransaction:(()=>void)|null=null;
const db:any={collection,async runTransaction(fn:any){beforeTransaction?.();beforeTransaction=null;const writes:any[]=[];let wrote=false;const tx:any={get:async(r:any)=>{if(wrote)throw Error('read after write');return r.get();}};for(const m of ['set','create'])tx[m]=(r:any,v:any)=>{wrote=true;writes.push([m,r,v]);};const result=await fn(tx);for(const [m,r] of writes)if(m==='create'&&data.has(r.path))throw Error('exists');for(const [,r,v] of writes)data.set(r.path,clone(v));return result;}};
let seq=0;const op=()=>'operation-'+(++seq);
const act=(uid:string,action:string,body:any)=>handlePayrollItemsAction(db,uid,action,body);
const err=async(p:Promise<any>)=>{try{await p;return 0;}catch(e:any){return e.statusCode;}};
const propose=(uid='A1',extra:any={})=>act(uid,'propose-payroll-item-inventory',{inventory:inventory(),expectedRevision:0,operationId:op(),...extra});
const review=(p:any,uid='A2',extra:any={})=>act(uid,'review-payroll-item-inventory',{empId:p.empId,month:p.month,expectedRevision:p.revision,mode:'approve',reason:'核對項目與來源證據完成',operationId:op(),...extra});
const get=(uid='A1',extra:any={})=>act(uid,'get-payroll-item-inventory',{empId:'E1',month:'2026-08',...extra});
beforeEach(()=>{data.clear();beforeTransaction=null;seq=0;for(const id of ['A1','A2','A3'])data.set('employees/'+id,{id,role:UserRole.SuperAdmin});data.set('employees/ADMIN',{id:'ADMIN',role:UserRole.Admin});data.set('employees/E1',{id:'E1',role:UserRole.Employee});data.set('employees/E2',{id:'E2',role:UserRole.Employee});data.set('employees/SYS',{id:'SYS',role:UserRole.SuperAdmin,accountKind:'system-account'});});

describe('monthly item evidence workflow',()=>{
 it('records immutable proposed and approved versions without adopting money or statutory classifications',async()=>{
  const p=await propose();expect(p.status).toBe('proposed');expect(p.revision).toBe(1);const initial=clone(data.get('payrollItemInventoryVersions/'+p.id+'_1'));
  const a=await review(p);expect(a).toMatchObject({status:'approved',revision:2,approvedBy:'A2',approvalScope:'recorded-evidence-only',applicationStatus:'not-applied',paymentStatus:'not-paid'});
  expect(data.get('payrollItemInventoryVersions/'+p.id+'_1')).toEqual(initial);expect(data.get('payrollItemInventoryVersions/'+p.id+'_2')).toEqual(a);
  const assessment=assessPayrollItemInventory(a);expect(assessment.status).toBe('recorded-items-needs-classification');expect(assessment.formalEligibility).toBe('BLOCKED');expect(assessment.issues.length).toBeGreaterThan(0);expect(a.netSalary).toBeUndefined();
 });
 it('requires distinct approval for explicit no-other-items and preserves its attestation',async()=>{const p=await propose('A1',{inventory:none()});expect(assessPayrollItemInventory(p).status).toBe('unreviewed');const a=await review(p);expect(assessPayrollItemInventory(a).status).toBe('confirmed-none');expect(a.inventory.reason).toBe(none().reason);expect(assessPayrollItemInventory(a).formalEligibility).toBe('BLOCKED');});
 it('cannot self approve or approve own employee record',async()=>{const p=await propose();expect(await err(review(p,'A1'))).toBe(403);const own=await propose('A1',{inventory:inventory({empId:'A2'})});expect(await err(review(own,'A2'))).toBe(403);});
 it('does not let a historical proposer approve after return and another author replacement',async()=>{const p=await propose();const returned=await review(p,'A2',{mode:'return'});const replacement=await propose('A3',{expectedRevision:returned.revision,inventory:inventory({reason:'合成補件後重新提出清冊'})});expect(await err(review(replacement,'A1'))).toBe(403);expect((await review(replacement,'A2')).status).toBe('approved');});
 it('a proposed replacement invalidates prior approval while retaining the immutable old version',async()=>{const a=await review(await propose());const replaced=await propose('A3',{expectedRevision:a.revision,inventory:inventory({items:[item({amount:'1300'})]})});expect(assessPayrollItemInventory(replaced).status).toBe('unreviewed');expect((await get()).current.status).toBe('proposed');expect(data.get('payrollItemInventoryVersions/'+a.id+'_'+a.revision)).toEqual(a);});
 it('rejects mutation of pending proposals and stale revisions',async()=>{const p=await propose();expect(await err(propose('A3',{expectedRevision:p.revision}))).toBe(409);expect(await err(review(p,'A2',{expectedRevision:0}))).toBe(409);});
 it('exact command replay is idempotent and changed payload is refused',async()=>{const command={inventory:inventory(),expectedRevision:0,operationId:'same-op'};const p=await act('A1','propose-payroll-item-inventory',command);const count=data.size;expect(await act('A1','propose-payroll-item-inventory',command)).toEqual(p);expect(data.size).toBe(count);expect(await err(act('A1','propose-payroll-item-inventory',{...command,inventory:none()}))).toBe(409);});
 it('rereads actor role inside the transaction and on exact replay',async()=>{beforeTransaction=()=>data.set('employees/A1',{id:'A1',role:UserRole.Employee});expect(await err(propose())).toBe(403);data.set('employees/A1',{id:'A1',role:UserRole.SuperAdmin});const command={inventory:inventory(),expectedRevision:0,operationId:'role-replay'};await act('A1','propose-payroll-item-inventory',command);data.set('employees/A1',{id:'A1',role:UserRole.Employee});expect(await err(act('A1','propose-payroll-item-inventory',command))).toBe(403);});
 it('blocks both new evidence and approval when month locked without writing versions',async()=>{data.set('monthLocks/2026-08',{yearMonth:'2026-08',lockedAt:'2026-09-01T00:00:00Z'});expect(await err(propose())).toBe(423);data.delete('monthLocks/2026-08');const p=await propose();const before=clone([...data]);data.set('monthLocks/2026-08',{yearMonth:'2026-08',lockedAt:'2026-09-01T00:00:00Z'});expect(await err(review(p))).toBe(423);expect([...data].filter(([k])=>k.startsWith('payrollItem'))).toEqual(before.filter(([k]:any)=>k.startsWith('payrollItem')));});
 it('restricts salary access and excludes pure system accounts',async()=>{expect(await err(propose('ADMIN'))).toBe(403);expect(await err(propose('E1'))).toBe(403);expect(await err(propose('A1',{inventory:inventory({empId:'SYS'})}))).toBe(409);expect(await err(get('E2'))).toBe(403);expect(await err(get('ADMIN'))).toBe(403);});
 it('employees see only their approved evidence, not pending entries',async()=>{const p=await propose();const pending=await get('E1');expect(pending.current).toBeNull();expect(pending.versions).toEqual([]);await review(p);const own=await get('E1');expect(own.current.status).toBe('approved');expect(own.versions.every((v:any)=>v.status==='approved')).toBe(true);});
 it('rejects unknown action or server-owned mutation fields before writes',async()=>{expect(await err(act('A1','delete-payroll-item-inventory',{empId:'E1',month:'2026-08'}))).toBe(400);expect(await err(propose('A1',{approvedBy:'A2'}))).toBe(400);const p=await propose();expect(await err(review(p,'A2',{applicationStatus:'applied'}))).toBe(400);});
 it('never treats a malformed approval as confirmed-none',async()=>{const a=await review(await propose('A1',{inventory:none()}));expect(assessPayrollItemInventory({...a,approvedBy:'A1'}).status).toBe('unreviewed');expect(assessPayrollItemInventory({...a,approvedAt:'bad'}).status).toBe('unreviewed');});
});

describe('immutable payroll item history authority',()=>{
 it('rejects an approved attestation whose history omits its proposal event',async()=>{
  const approved=await review(await propose('A1',{inventory:none()}));
  const corrupted={...approved,history:approved.history.filter((h:any)=>h.to!=='proposed')};
  expect(assessPayrollItemInventory(corrupted).status).toBe('unreviewed');
 });
 it('does not let deletion of an earlier proposer from the mutable head permit self approval',async()=>{
  const p=await propose();const returned=await review(p,'A2',{mode:'return'});
  const replacement=await propose('A3',{expectedRevision:returned.revision});
  const key='payrollItemInventories/'+p.id,head=clone(data.get(key));
  head.history=head.history.filter((h:any)=>!(h.to==='proposed'&&h.actor==='A1'));
  data.set(key,head);const before=clone([...data]);
  expect(await err(review(replacement,'A1'))).toBe(409);
  expect([...data]).toEqual(before);
 });
 it('rejects head history that names a different earlier author than immutable versions even when its revisions remain complete',async()=>{
  const p=await propose();const returned=await review(p,'A2',{mode:'return'});
  const replacement=await propose('A3',{expectedRevision:returned.revision});
  const key='payrollItemInventories/'+p.id,head=clone(data.get(key));
  head.history[0].actor='A3';data.set(key,head);const before=clone([...data]);
  expect(await err(review(replacement,'A1'))).toBe(409);
  expect(await err(get())).toBe(409);
  expect([...data]).toEqual(before);
 });
 it('holds a chain with a missing immutable earlier revision even when mutable head history looks valid',async()=>{
  const p=await propose();const returned=await review(p,'A2',{mode:'return'});
  const replacement=await propose('A3',{expectedRevision:returned.revision});
  data.delete('payrollItemInventoryVersions/'+p.id+'_1');const before=clone([...data]);
  expect(await err(review(replacement,'A2'))).toBe(409);
  expect([...data]).toEqual(before);
 });
});

describe('existing employee identity compatibility',()=>{
 it.each([
  {label:'email-shaped employee',empId:'Synthetic.Employee@example.test',author:'A1',reviewer:'A2'},
  {label:'email-shaped proposal author',empId:'E1',author:'synthetic.author@example.test',reviewer:'A2'},
  {label:'email-shaped independent reviewer',empId:'E1',author:'A1',reviewer:'synthetic.reviewer@example.test'},
 ])('preserves $label through propose, independent approval and own approved-only read',async({empId,author,reviewer})=>{
  data.set('employees/'+empId,{id:empId,role:UserRole.Employee});
  for(const uid of [author,reviewer])data.set('employees/'+uid,{id:uid,role:UserRole.SuperAdmin});
  const proposed=await propose(author,{inventory:{...none(),empId}});
  expect((await get(empId,{empId})).current).toBeNull();
  const approved=await review(proposed,reviewer);
  expect(approved).toMatchObject({empId,proposedBy:author,approvedBy:reviewer});
  const own=await get(empId,{empId});
  expect(own.current.empId).toBe(empId);expect(own.canManage).toBe(false);
  expect(own.assessment.status).toBe('confirmed-none');
 });
 it('does not broaden metadata references to email addresses while supporting account identities',()=>{
  expect(status(()=>validatePayrollItemInventory(inventory({sourceRefs:['synthetic.source@example.test']})))).toBe(400);
 });
});
