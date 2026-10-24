import type {Interval} from '../../../utils/attendance';
export type OvertimeStatus='submitted'|'needs-info'|'preauthorized'|'approved'|'partial-approved'|'rejected'|'cancelled'|'superseded';
export interface OvertimeRequest {
 id:string;schemaVersion:'overtime-request-v1';empId:string;revision:number;status:OvertimeStatus;
 phase:'before'|'after';kind:'on-site'|'offsite'|'travel';reason:string;startDate:string;endDate:string;
 requestedMinutes:number;actualWorkMinutes:number|null;approvedMinutes:number|null;statutoryPayableMinutes:null;
 actualSource:{version:string;intervals:Interval[];unknown:boolean;refs:unknown[]};
 approvedIntervals:Interval[];authorizedIntervals:Interval[];dayType:'unverified';complianceStatus:'needs-review';
 policyStatus:'needs-review';caseId:string|null;history:any[];supersedesId?:string;supersededBy?:string;
}
