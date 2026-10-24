import LeaveLifecyclePanel from '../LeaveLifecyclePanel';
import MakeupAttachmentPanel,{type AttachmentSelection} from '../MakeupAttachmentPanel';
import {apiGetEmployeeLeaveRequests} from '../../services/googleAppsScriptAPI';
import {useAnomalyOperation} from '../../hooks/useAnomalyOperation';
import AnomalyOperationRecovery from '../AnomalyOperationRecovery';
import {apiExplanationWorkflow,type CaseExplanationWorkflow} from '../../services/googleAppsScriptAPI';
import { contextDateMatches, type CaseFormContext } from '../../utils/caseFormContext';

import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiSubmitLeaveRequest, apiGetLeaveBalance } from '../../services/googleAppsScriptAPI';
import { LeaveType, LeaveRequest, LeaveBalance, OUTING_LEAVE_TYPES, isOutingLeaveType } from '../../types';

const REGULAR_LEAVE_TYPES: LeaveType[] = [LeaveType.Personal, LeaveType.Sick, LeaveType.Annual, LeaveType.Other];

const LeaveRequestForm: React.FC<{caseContext?:CaseFormContext;explanationId?:string;requestId?:string}> = ({caseContext,explanationId,requestId}) => {
  const { user } = useAuth();const operation=useAnomalyOperation(),gate=useRef(false);
  const [attachment,setAttachment]=useState<AttachmentSelection>({ready:false}),[attachmentReset,setAttachmentReset]=useState(0),[history,setHistory]=useState<LeaveRequest[]>([]);
  const loadHistory=async()=>{if(user)try{setHistory(await apiGetEmployeeLeaveRequests(user.id));}catch{setMessage({type:'error',text:'假單歷程讀取失敗'});}};
  useEffect(()=>{void loadHistory();},[user?.id]);
  const [workflow,setWorkflow]=useState<CaseExplanationWorkflow|null>(null);
  const loadSource=async()=>{if(caseContext)try{setWorkflow(await apiExplanationWorkflow(caseContext.caseId));}catch{setWorkflow(null);setMessage({type:'error',text:'追補來源讀取失敗，不能提交。'});}};
  useEffect(()=>{void loadSource();},[caseContext?.caseId]);
  const [leaveType, setLeaveType] = useState<LeaveType>(LeaveType.Personal);
  const [caseStartDay,setCaseStartDay]=useState(caseContext?.date||'');
  const [caseEndDay,setCaseEndDay]=useState(caseContext?.date||'');
  const [caseStartTime,setCaseStartTime]=useState('');
  const [caseEndTime,setCaseEndTime]=useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: string, text: string } | null>(null);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);

  useEffect(() => {
    apiGetLeaveBalance().then(setBalances).catch(() => {});
  }, []);

  useEffect(()=>{if(caseContext){setStartDate(caseStartDay&&caseStartTime?caseStartDay+'T'+caseStartTime+':00+08:00':'');setEndDate(caseEndDay&&caseEndTime?caseEndDay+'T'+caseEndTime+':00+08:00':'');}},[caseContext,caseStartDay,caseEndDay,caseStartTime,caseEndTime]);

  const currentBalance = balances.find(b => b.leaveType === leaveType);
  const requestedHours = startDate && endDate
    ? Math.max(0, (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60))
    : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if(!attachment.ready||gate.current||operation.pending||operation.blocked||caseContext&&!workflow)return;
    if (!user || !startDate || !endDate || !reason) {
      setMessage({ type: 'error', text: '所有欄位皆為必填。' });
      return;
    }
    if(caseContext&&(caseContext.empId!==user.id||!contextDateMatches(caseContext,caseStartDay))){setMessage({type:'error',text:'案件員工或日期不符，請核對案件範圍。'});return;}
    // Phase 3.4 日期驗證
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      setMessage({ type: 'error', text: '日期格式錯誤。' });
      return;
    }
    if (endMs <= startMs) {
      setMessage({ type: 'error', text: '結束時間必須晚於開始時間。' });
      return;
    }
    const hours = (endMs - startMs) / (1000 * 60 * 60);
    if (hours < 1/60) {
      setMessage({ type: 'error', text: '請填至少一個完整分鐘；計薪分鐘仍待覆核。' });
      return;
    }
    // Displayed legacy balance is not an approved quota policy; server checks reservations.
    gate.current=true;setSubmitting(true);
    setMessage(null);

    const newRequest: Omit<LeaveRequest, 'id' | 'requestDate' | 'status' | 'approver' | 'approvalDate' | 'hours' | 'name'> = {
        empId: user.id,
        leaveType,
        startDate,
        endDate,
        reason
    }

    try {
      const success = caseContext ? await operation.attempt({action:'submit-case-leave',command:{caseId:caseContext.caseId,expectedCaseRevision:workflow!.caseRevision,expectedEvidenceVersion:workflow!.evidenceVersion,operationId:crypto.randomUUID(),reason,leaveType,startDate,endDate,attachmentDraftId:attachment.attachmentDraftId,expectedAttachmentDraftRevision:attachment.expectedAttachmentDraftRevision,...(explanationId?{explanationId}:{})}}) : await apiSubmitLeaveRequest({...newRequest,...attachment} as any);
      if (success) {
        setMessage({ type: 'success', text: '請假申請已成功送出！' });
        // Reset form
        setLeaveType(LeaveType.Personal);
        setStartDate('');
        setEndDate('');
        setReason('');setAttachmentReset(n=>n+1);await loadHistory();if(caseContext){setCaseStartTime('');setCaseEndTime('');await loadSource();}
      } else {
        setMessage({ type: 'error', text: '送出失敗，請稍後再試。' });
      }
    } catch (error: any) {
        setMessage({ type: 'error', text: error?.message || '發生未知錯誤。' });
    } finally {
      gate.current=false;setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto mt-4 p-6 bg-white rounded-lg shadow-md">
      <MakeupAttachmentPanel subjectType="leave" date={caseContext?caseStartDay:startDate.slice(0,10)} onSelection={setAttachment} resetKey={attachmentReset} disabled={submitting||!!operation.pending}/>
      <h2 className="text-2xl font-bold text-center mb-6 text-gray-800">請假／外勤申請</h2>
      <AnomalyOperationRecovery onResolved={()=>void loadSource()}/>
      {caseContext&&<p>追補假沿用本表單；跨度不是已核工作／計薪分鐘，假別、休息及外勤政策待核，採納說明不等於假單核准。{explanationId&&`來源說明 ${explanationId}`}</p>}
      {requestId&&<div className="border p-2"><p>關聯假單 {requestId}</p>{workflow?.leaves.filter(r=>r.id===requestId).map(r=><p key={r.id}>{r.leaveType} · {r.startDate} – {r.endDate} · {r.status} · {r.reviewIssues?.join('／')}</p>)}</div>}
      {caseContext&&<button type="button" disabled={submitting} onClick={()=>void loadSource()}>重新讀取追補來源</button>}
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="leaveType" className="block text-sm font-medium text-gray-700">類別</label>
          <select
            id="leaveType"
            value={leaveType}
            onChange={(e) => setLeaveType(e.target.value as LeaveType)}
            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-brand-green-dark focus:border-brand-green-dark sm:text-sm rounded-md"
          >
            <optgroup label="請假">
              {REGULAR_LEAVE_TYPES.map(lt => <option key={lt} value={lt}>{lt}</option>)}
            </optgroup>
            <optgroup label={caseContext?"外勤（工時與給付政策待核）":"外勤（工時與給付政策待核）"}>
              {OUTING_LEAVE_TYPES.map(lt => <option key={lt} value={lt}>{lt}</option>)}
            </optgroup>
          </select>
          {currentBalance && leaveType !== LeaveType.Other && (
            <div className="mt-1 text-xs text-gray-500 space-y-0.5">
              <p>
                本年度{leaveType}剩餘 <span className="font-semibold text-brand-green-dark">{currentBalance.remainingHours}h</span>
                （配額 {currentBalance.quotaHours}h，已用 {currentBalance.usedHours}h）
                {requestedHours > 0 && (
                  <span className={`ml-2 ${requestedHours > currentBalance.remainingHours ? 'text-red-600' : 'text-gray-500'}`}>
                    本次申請 {requestedHours.toFixed(1)}h
                  </span>
                )}
              </p>
              {/* Phase 8.5：特休專屬結轉提示（沿用 Phase 8.1 annualLeaveDetail） */}
              {leaveType === LeaveType.Annual && currentBalance.annualLeaveDetail && (
                <>
                  <p className="text-gray-500">
                    今年新給 {currentBalance.annualLeaveDetail.newGrantedHours}h
                    {currentBalance.annualLeaveDetail.carriedFromPreviousYear > 0 && (
                      <>
                        ｜去年結轉 <span className="text-blue-600 font-medium">{currentBalance.annualLeaveDetail.carriedFromPreviousYear}h</span>
                        ，於 {currentBalance.annualLeaveDetail.carriedExpiresAt} 失效
                      </>
                    )}
                  </p>
                  {currentBalance.annualLeaveDetail.expiredHours > 0 && (
                    <p className="text-red-600 font-medium">
                      已失效 {currentBalance.annualLeaveDetail.expiredHours}h（超過 1 年保留期）
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {isOutingLeaveType(leaveType) && (
            <p className="mt-1 text-xs text-blue-600">
              {caseContext?'外勤來源、工時門檻與給付政策仍待覆核；核准申請不代表計薪完成。':'外勤工時、出勤對照與給付政策仍須覆核，不以核准申請直接認定薪資。'}
            </p>
          )}
          <p className="mt-2 text-xs text-gray-400">
            {caseContext?'追補申請仍需核對假別有效性、餘額與給付政策，不以本表單跨度認定薪資。':'舊版顯示餘額僅供覆核，不能代替有效期額度政策；伺服器只依明確核定政策檢查預占。未知額度與補申請期限仍待設定。'}
          </p>
        </div>

        {caseContext ? <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend>案件請假時段（台北；時間待核實，不自動填入）</legend>
          <label>案件請假開始日<input className="block border p-2" type="date" required value={caseStartDay} onChange={e=>setCaseStartDay(e.target.value)}/></label>
          <label>案件請假開始時間<input className="block border p-2" type="time" required value={caseStartTime} onChange={e=>setCaseStartTime(e.target.value)}/></label>
          <label>案件請假結束日<input className="block border p-2" type="date" required value={caseEndDay} onChange={e=>setCaseEndDay(e.target.value)}/></label>
          <label>案件請假結束時間<input className="block border p-2" type="time" required value={caseEndTime} onChange={e=>setCaseEndTime(e.target.value)}/></label>
        </fieldset> : <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
            <label htmlFor="startDate" className="block text-sm font-medium text-gray-700">開始日期</label>
            <input
                type="datetime-local"
                id="startDate"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-brand-green-dark focus:border-brand-green-dark sm:text-sm"
            />
            </div>
            <div>
            <label htmlFor="endDate" className="block text-sm font-medium text-gray-700">結束日期</label>
            <input
                type="datetime-local"
                id="endDate"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-brand-green-dark focus:border-brand-green-dark sm:text-sm"
            />
            </div>
        </div>
        </>}

        <div>
          <label htmlFor="reason" className="block text-sm font-medium text-gray-700">事由</label>
          <textarea
            id="reason"
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm focus:ring-brand-green-dark focus:border-brand-green-dark sm:text-sm"
          ></textarea>
        </div>

        {message && (
            <div className={`p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-green-100 text-status-success' : 'bg-red-100 text-status-error'}`}>
                {message.text}
            </div>
        )}

        <div>
          <button
            type="submit"
            disabled={!attachment.ready||submitting||!!operation.pending||operation.blocked||!!caseContext&&!workflow}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand-green-dark hover:bg-brand-green-light focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-gray-400"
          >
            {submitting ? '送出中...' : '送出申請'}
          </button>
        </div>
      </form>
      <h3>本人假單與版本</h3>{history.filter(r=>!requestId||r.id===requestId).map(r=><div key={r.id+String(r.revision)}><LeaveLifecyclePanel requestId={r.id} onChanged={()=>void loadHistory()}/></div>)}
    </div>
  );
};

export default LeaveRequestForm;
