import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {readPendingCaseOperation,savePendingCaseOperation,clearPendingCaseOperation} from '../services/pendingCaseOperation';
let values:Map<string,string>;
beforeEach(()=>{values=new Map();vi.stubGlobal('sessionStorage',{getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)});});
afterEach(()=>vi.unstubAllGlobals());
const c={caseId:'case1',operationId:'op1',reason:'synthetic unchanged',mode:'explain' as const,expectedRevision:1,expectedEvidenceVersion:'v1'};
it('persists exact retry content in a principal-specific tab key without auth data',()=>{savePendingCaseOperation('E1',{...c,token:'must-not-persist'} as any);expect(readPendingCaseOperation('E1')).toEqual(c);expect(readPendingCaseOperation('OTHER')).toBeNull();expect([...values.values()].join()).not.toContain('must-not-persist');});
it('a read never consumes the pending command; only explicit confirmed cleanup removes it',()=>{savePendingCaseOperation('E1',c);expect(readPendingCaseOperation('E1')).toEqual(c);expect(readPendingCaseOperation('E1')).toEqual(c);clearPendingCaseOperation('E1');expect(readPendingCaseOperation('E1')).toBeNull();});
it('malformed or unavailable storage fails closed rather than generating a replacement ID',()=>{values.set('attendance-pending-v1:E1','{"mode":"forged"}');expect(()=>readPendingCaseOperation('E1')).toThrow();vi.stubGlobal('sessionStorage',{setItem:()=>{throw Error('storage blocked');}});expect(()=>savePendingCaseOperation('E1',c)).toThrow();});
