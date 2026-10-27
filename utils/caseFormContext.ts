import { taipeiDate, localInstant } from './attendance';
import type { CaseDetail } from '../services/attendanceCaseContract';
export interface CaseFormContext { caseId:string;empId:string;start:number;end:number;date:string|null;recordId:string|null }
// Only created from the authenticated case DTO, never query strings. A broad
// scope window cannot establish an incident date or actual work/leave times.
export const caseFormContext=(c:CaseDetail):CaseFormContext=>({caseId:c.id,empId:c.empId,start:c.window.start,end:c.window.end,
 date:!c.anchor.startsWith('scope')&&c.window.end-c.window.start<=2880?taipeiDate(new Date(c.window.start*60000)):null,
 recordId:c.anchor.startsWith('card:')?c.anchor.slice(5):null});
export const contextDateMatches=(c:CaseFormContext,date:string)=>{const t=localInstant(date,'00:00');if(!t)return false;const start=Date.parse(t)/60000;return start<c.end&&c.start<start+1440;};
export const contextLeaveMatches=(c:CaseFormContext,r:{empId:string;startDate:string;endDate:string})=>r.empId===c.empId&&Date.parse(r.startDate)/60000<c.end&&c.start<Date.parse(r.endDate)/60000;
