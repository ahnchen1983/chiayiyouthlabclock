/** Server-reviewed policy inputs. This batch has no endpoint that approves these. */
export interface CompPolicy {
 empId:string;status:'draft'|'approved';version:string;approvedBy:string;approvedAt:string;
 employeeAgreedBy:string;employeeAgreedAt:string;reviewerIds:string[];
 effectiveFrom:string;effectiveTo:string;deadline:string;annualEnd:string;
 reservePending:true;minuteBasis:'explicit-request-interval';conversion:'one-to-one';
}
export interface CompSourceReview {
 empId:string;status:'draft'|'approved';version:string;approvedBy:string;approvedAt:string;
 dayEvidence?:Record<string,{dayType:'normal'|'rest'|'unverified';eligibleMinutes:number;originalWageBasis?:CompSourceReview['originalWageBasis']}>;
 overtimeVersion:string;dayType:'normal'|'rest'|'unverified';eligibleMinutes:number;
 originalWageBasis:{status:'pending-payroll'|'confirmed';originalDate:string;rate:number|null;tiers:unknown[]|null;version?:string;reviewedBy?:string;reviewedAt?:string};
}
export type CompRequestStatus='submitted'|'pending-policy'|'needs-info'|'approved'|'cancelled'|'rejected'|'superseded';
