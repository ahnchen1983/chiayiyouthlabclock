import type { CaseCommand } from './attendanceCaseContract';
const key=(uid:string)=>'attendance-pending-v1:'+uid;
const normalize=(v:any):CaseCommand=>{
 if(!v||!['assign','explain','resolve','reopen','request-info'].includes(v.mode)||!Number.isInteger(v.expectedRevision)||v.expectedRevision<1)throw Error('Invalid pending operation');
 for(const k of ['caseId','operationId','reason','expectedEvidenceVersion'])if(typeof v[k]!=='string'||!v[k]||v[k].length>2000)throw Error('Invalid pending operation');
 if(v.owner!==undefined&&(typeof v.owner!=='string'||v.owner.length>150))throw Error('Invalid pending owner');
 return {caseId:v.caseId,mode:v.mode,operationId:v.operationId,reason:v.reason,expectedRevision:v.expectedRevision,expectedEvidenceVersion:v.expectedEvidenceVersion,...(v.owner!==undefined?{owner:v.owner}:{})};
};
// Tab-session intent journal; no auth token, salary, provider secret, or raw card.
// Never auto-send on restore. Storage failure blocks a new mutation before fetch.
export const readPendingCaseOperation=(uid:string):CaseCommand|null=>{const raw=sessionStorage.getItem(key(uid));return raw?normalize(JSON.parse(raw)):null;};
export const savePendingCaseOperation=(uid:string,c:CaseCommand)=>sessionStorage.setItem(key(uid),JSON.stringify(normalize(c)));
export const clearPendingCaseOperation=(uid:string)=>sessionStorage.removeItem(key(uid));
