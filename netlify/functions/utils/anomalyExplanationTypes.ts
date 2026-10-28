export type ExplanationStatus='submitted'|'needs-info'|'accepted'|'rejected'|'cancelled'|'superseded';
export interface AnomalyExplanation {
 id:string;schemaVersion:'anomaly-explanation-v1';empId:string;caseId:string;revision:number;status:ExplanationStatus;
 text:string;startDate:string;endDate:string;caseEvidenceVersion:string;sourceRefs:unknown[];
 acceptedSource?:{caseId:string;empId:string;evidenceVersion:string;startDate:string;endDate:string;refsHash:string;explanationRevision:number;acceptedBy:string;acceptedAt:string;hash:string};
 supersedesId:string|null;supersededBy?:string;createdBy:string;createdAt:string;updatedAt:string;
 history:{id:string;revision:number;actor:string;at:string;from:string|null;to:ExplanationStatus;reason:string}[];
}
