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
import { LeaveType, LeaveRequest, LeaveBalance, OUTING_LEAVE_TYPES } from '../../types';

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
  const [leaveDay, setLeaveDay] = useState('');
  const [leaveHours, setLeaveHours] = useState('1');
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
  const hourValue = Number(leaveHours);
  const requestedHours = caseContext && startDate && endDate
    ? Math.max(0, (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60))
    : Number.isFinite(hourValue) ? hourValue : 0;
  const applyDayHours = () => {
    if (!leaveDay || !Number.isFinite(hourValue) || hourValue <= 0 || Math.round(hourValue * 2) !== hourValue * 2) return null;
    const [year, month, day] = leaveDay.split('-').map(Number);
    const end = new Date(year, month - 1, day, 9, 0, 0, 0);
    end.setMinutes(end.getMinutes() + Math.round(hourValue * 60));
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      startDate: `${leaveDay}T09:00`,
      endDate: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if(!attachment.ready||gate.current||operation.pending||operation.blocked||caseContext&&!workflow)return;
    const span = caseContext ? { startDate, endDate } : applyDayHours();
    if (!user || !span || !reason) {
      setMessage({ type: 'error', text: '請填寫一天的日期、0.5 小時為單位的時數，以及原因。' });
      return;
    }
    const { startDate: startValue, endDate: endValue } = span;
    if(caseContext&&(caseContext.empId!==user.id||!contextDateMatches(caseContext,caseStartDay))){setMessage({type:'error',text:'案件員工或日期不符，請核對案件範圍。'});return;}
    // Phase 3.4 日期驗證
    const startMs = new Date(startValue).getTime();
    const endMs = new Date(endValue).getTime();
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
      setMessage({ type: 'error', text: '請填至少 0.5 小時。' });
      return;
    }
    // Displayed legacy balance is not an approved quota policy; server checks reservations.
    gate.current=true;setSubmitting(true);
    setMessage(null);

    const newRequest: Omit<LeaveRequest, 'id' | 'requestDate' | 'status' | 'approver' | 'approvalDate' | 'hours' | 'name'> = {
        empId: user.id,
        leaveType,
        startDate: startValue,
        endDate: endValue,
        reason
    }

    try {
      const success = caseContext ? await operation.attempt({action:'submit-case-leave',command:{caseId:caseContext.caseId,expectedCaseRevision:workflow!.caseRevision,expectedEvidenceVersion:workflow!.evidenceVersion,operationId:crypto.randomUUID(),reason,leaveType,startDate:startValue,endDate:endValue,attachmentDraftId:attachment.attachmentDraftId,expectedAttachmentDraftRevision:attachment.expectedAttachmentDraftRevision,...(explanationId?{explanationId}:{})}}) : await apiSubmitLeaveRequest({...newRequest,...attachment} as any);
      if (success) {
        setMessage({ type: 'success', text: '請假申請已送出' });
        setLeaveType(LeaveType.Personal);
        setLeaveDay('');
        setLeaveHours('1');
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
    <div className="mt-4 p-6 bg-white rounded-lg shadow-md yl-leave">
      <details className="mb-4"><summary>證明附件</summary><MakeupAttachmentPanel subjectType="leave" date={caseContext?caseStartDay:leaveDay} onSelection={setAttachment} resetKey={attachmentReset} disabled={submitting||!!operation.pending}/></details>
      <h2 className="text-2xl font-bold text-gray-800 mb-2">{caseContext ? '請假／外勤申請' : '請假申請'}</h2>
      <p className="text-sm text-gray-600 mb-4">特休送出後會先預留時數；退回或撤回後自動釋放。</p>
      <AnomalyOperationRecovery onResolved={()=>void loadSource()}/>
      {caseContext&&<button type="button" disabled={submitting} onClick={()=>void loadSource()}>重新讀取追補來源</button>}
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="leaveType" className="block text-sm font-medium text-gray-700">假別</label>
          <select
            id="leaveType"
            value={leaveType}
            onChange={(e) => setLeaveType(e.target.value as LeaveType)}
            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-brand-green-dark focus:border-brand-green-dark sm:text-sm rounded-md"
          >
            <optgroup label="請假">
              {REGULAR_LEAVE_TYPES.map(lt => <option key={lt} value={lt}>{lt}</option>)}
            </optgroup>
            <optgroup label="外勤">
              {OUTING_LEAVE_TYPES.map(lt => <option key={lt} value={lt}>{lt}</option>)}
            </optgroup>
          </select>
          {currentBalance && leaveType !== LeaveType.Other && (
            <div className="yl-balance text-xs text-gray-500 space-y-0.5">
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
            <label htmlFor="leaveDay" className="block text-sm font-medium text-gray-700">日期</label>
            <input
                type="date"
                id="leaveDay"
                value={leaveDay}
                onChange={(e) => setLeaveDay(e.target.value)}
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-brand-green-dark focus:border-brand-green-dark sm:text-sm"
            />
            </div>
            <div>
            <label htmlFor="leaveHours" className="block text-sm font-medium text-gray-700">時數</label>
            <input
                type="number"
                id="leaveHours"
                min="0.5"
                max="12"
                step="0.5"
                value={leaveHours}
                onChange={(e) => setLeaveHours(e.target.value)}
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
            placeholder="簡單說明你的安排"
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm focus:ring-brand-green-dark focus:border-brand-green-dark sm:text-sm"
          ></textarea>
        </div>

        {message && (
            <div className={`p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-green-100 text-status-success' : 'bg-red-100 text-status-error'}`}>
                {message.text}
            </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={!attachment.ready||submitting||!!operation.pending||operation.blocked||!!caseContext&&!workflow}
            className="yl-primary-action flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand-green-dark hover:bg-brand-green-light focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-gray-400"
          >
            {submitting ? '送出中...' : '送出申請'}
          </button>
          <button type="button" className="px-4 py-2 text-sm" onClick={() => { setLeaveDay(''); setLeaveHours('1'); setReason(''); setMessage(null); }}>取消</button>
        </div>
      </form>
      <h3 className="mt-6 font-semibold">我的申請</h3>{history.filter(r=>!requestId||r.id===requestId).map(r=><div key={r.id+String(r.revision)}><LeaveLifecyclePanel requestId={r.id} onChanged={()=>void loadHistory()}/></div>)}
    </div>
  );
};

export default LeaveRequestForm;
