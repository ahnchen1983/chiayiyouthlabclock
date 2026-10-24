import type { CaseStatus, CaseType, Outcome, Window } from '../netlify/functions/utils/attendanceCaseTypes';
export type { CaseStatus, CaseType };
export interface CaseSummary {
 id:string; empId:string; type:CaseType; anchor:string; status:CaseStatus; owner:string|null;
 revision:number; expectedEvidenceVersion:string; window:Window; outcome:Outcome; reason:string;
 history:{id:string;revision:number;actor:string;at:string;from:CaseStatus|null;to:CaseStatus;reason:string}[];
}
export interface CaseDetail extends CaseSummary {
 notifications:{mode:'sandbox-only';counts:Record<string,number>;complete:boolean;deliveryEnabled:false};
}
export interface CaseQuery {empId:string;yearMonth:string;status?:CaseStatus;type?:CaseType;afterId?:string}
export interface CasePage {cases:CaseSummary[];nextCursor:string|null;scope:string}
export interface CaseCommand {caseId:string;mode:'assign'|'explain'|'resolve'|'reopen'|'request-info';operationId:string;reason:string;owner?:string;expectedRevision:number;expectedEvidenceVersion:string}
export const caseTypes:Record<CaseType,string>={
 'missing-in':'缺上班卡','missing-out':'缺下班卡','unexplained-absence':'整段無卡／原因待核','late':'遲到候選','early':'早退候選','hours-difference':'工時差異','unscheduled-card':'有卡無班','sequence-overlap':'重複／順序／重疊','overnight-date':'跨夜日期','work-leave-overlap':'工作與假單重疊','pending-request':'申請待審／資料未完整','approved-unapplied':'已核准未反映／證據待核'
};
export const caseStatuses:Record<CaseStatus,string>={open:'待處理','awaiting-employee':'待本人說明','awaiting-review':'待管理者覆核','needs-info':'待補件／資料','resolved':'已結案',cancelled:'已取消'};
export const notificationStates:Record<string,string>={held:'暫存未送',queued:'排隊',leased:'測試處理中',retry:'測試重試待處理',delivered:'模擬送達', 'unknown-delivery':'模擬結果不明','dead-letter':'測試重試已達上限',unknown:'狀態未確認'};
