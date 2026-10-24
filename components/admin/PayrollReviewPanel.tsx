import React, { useEffect, useState, useRef } from 'react';
import { apiGetPayrollReviewInputs, apiReviewPayrollInputs, apiReviewLeaveAllocation } from '../../services/googleAppsScriptAPI';
import { LeaveType, type LeaveRequest, type PayrollReviewEmployee, type PayrollReviewInputs, type PayrollReviewSubmission, type PayrollScheduleGap } from '../../types';
import { hhmmMinutes, leaveEndMinutes } from '../../utils/attendance';
import { formatMoney } from '../../utils/format';

const fieldClass = 'w-full rounded border p-2 disabled:bg-gray-100';
const numberValue = (text: string, label: string, max = Infinity): number => {
    const value = Number(text);
    if (!text.trim() || !Number.isFinite(value) || value < 0 || value > max) throw new Error(`${label}尚未確認或數值無效`);
    return value;
};

const LeaveAllocationEditor: React.FC<{ leave: LeaveRequest; locked: boolean; onSaved: () => Promise<void>; onBusyChange: (busy: boolean) => void }> = ({ leave, locked, onSaved, onBusyChange }) => {
    const [rows, setRows] = useState(() => leave.payrollAllocations?.map(a => ({ date: a.date, from: a.from, to: a.to })) || [{ date: '', from: '', to: '' }]);
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const change = (index: number, key: 'date' | 'from' | 'to', value: string) => {
        setRows(current => current.map((row, i) => i === index ? { ...row, [key]: value } : row));
        setConfirmed(false); setSaved(false);
    };
    const save = async () => {
        setBusy(true); onBusyChange(true); setError(''); setSaved(false);
        try {
            if (!confirmed) throw new Error('請先確認已核對核准假單與逐日時段');
            if (!rows.length) throw new Error('請至少填寫一個實際請假／外勤時段');
            const allocations = rows.map(row => {
                const from = hhmmMinutes(row.from), to = leaveEndMinutes(row.to);
                if (!row.date || from === null || to === null || to <= from) throw new Error('請填寫有效日期與當日的起訖時間');
                return { ...row, minutes: to - from };
            });
            await apiReviewLeaveAllocation(leave.id, allocations,leave.revision);
            await onSaved(); setSaved(true); setConfirmed(false);
        } catch (e: any) { setError(e.message || '請假時段儲存失敗'); }
        finally { setBusy(false); onBusyChange(false); }
    };
    return <section className="rounded border bg-white p-3" aria-label={`${leave.leaveType}時段覆核`}>
        <h4 className="font-semibold">{leave.leaveType}：{leave.startDate.replace('T', ' ')} ～ {leave.endDate.replace('T', ' ')}</h4>
        <p className="mb-2 text-sm text-gray-600">核准時數 {leave.hours} 小時。請逐日填入實際請假／外勤時段，排除非工作時間；合計不得超過核准範圍與時數。當日午夜結束可填 24:00，跨日請分成兩筆。</p>
        <fieldset disabled={locked || busy} className="space-y-2">
            {rows.map((row, i) => <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                <input aria-label={`請假日期 ${i + 1}`} type="date" className={fieldClass} value={row.date} onChange={e => change(i, 'date', e.target.value)} />
                <input aria-label={`請假開始 ${i + 1}`} type="time" className={fieldClass} value={row.from} onChange={e => change(i, 'from', e.target.value)} />
                <input aria-label={`請假結束 ${i + 1}`} type="text" placeholder="HH:mm 或 24:00" className={fieldClass} value={row.to} onChange={e => change(i, 'to', e.target.value)} />
                <button type="button" onClick={() => { setRows(rows.filter((_, n) => n !== i)); setConfirmed(false); setSaved(false); }} className="rounded border text-sm">移除此段</button>
            </div>)}
            <button type="button" className="rounded border px-3 py-1 text-sm" onClick={() => { setRows([...rows, { date: '', from: '', to: '' }]); setConfirmed(false); setSaved(false); }}>新增請假時段</button>
            <label className="block text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> 我已核對核准假單與逐日時段</label>
            <button type="button" disabled={!confirmed} onClick={save} className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-50">儲存請假時段</button>
        </fieldset>
        {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    </section>;
};

const EmployeeReviewForm: React.FC<{ employee: PayrollReviewEmployee; month: string; locked: boolean; gaps: PayrollScheduleGap[]; onSaved: () => Promise<void>; onBusyChange: (busy: boolean) => void }> = ({ employee, month, locked, gaps, onSaved, onBusyChange }) => {
    const existing = employee.payrollReview?.yearMonth === month ? employee.payrollReview : undefined;
    const [excluded, setExcluded] = useState(existing?.participation === 'system-account');
    const [reason, setReason] = useState(existing?.participationReason || '');
    const [version, setVersion] = useState(existing?.policy?.version || '');
    const [precision, setPrecision] = useState(existing?.policy ? String(existing.policy.moneyDecimals) : '');
    const [divisor, setDivisor] = useState(existing?.policy?.monthlyHourlyDivisor?.toString() || '');
    const [dates, setDates] = useState<string[]>(existing?.policy?.regularDates || []);
    const [tiers, setTiers] = useState((existing?.policy?.overtimeTiers || []).map(t => ({ minutes: String(t.minutes), numerator: String(t.numerator), denominator: String(t.denominator) })));
    const monthly = employee.position === '專責人員';
    const fractions = monthly ? existing?.policy?.monthlyLeaveDeductionFraction : existing?.policy?.hourlyLeavePaidFraction;
    const [percentages, setPercentages] = useState<Partial<Record<LeaveType, string>>>(() => Object.fromEntries(Object.entries<number>(fractions || {}).map(([type, value]) => [type, String(value * 100)])));
    const [insurance, setInsurance] = useState({ labor: existing?.insurance?.labor?.toString() ?? '', health: existing?.insurance?.health?.toString() ?? '', pensionSelf: existing?.insurance?.pensionSelf?.toString() ?? '' });
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const [exceptions, setExceptions] = useState<Record<string, { checked: boolean; reason: string }>>(() => Object.fromEntries(gaps.map(gap => {
        const original = existing?.scheduleExceptions?.find(e => e.date === gap.date);
        return [gap.date, { checked: original?.sourceKey === gap.sourceKey, reason: original?.reason || '' }];
    })));
    const dayCount = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
    const changed = () => { setConfirmed(false); setSaved(false); };
    const save = async (event: React.FormEvent) => {
        event.preventDefault(); setBusy(true); onBusyChange(true); setError(''); setSaved(false);
        try {
            if (!confirmed) throw new Error('請先完成本月計薪資料的逐項確認');
            let review: PayrollReviewSubmission;
            if (excluded) {
                if (!reason.trim()) throw new Error('請填寫非受薪系統帳號的排除原因');
                review = { yearMonth: month, participation: 'system-account', participationReason: reason.trim() };
            } else {
                if (!version.trim() || !['0', '2'].includes(precision)) throw new Error('請確認政策版本與結算金額精度');
                const values = Object.fromEntries(Object.entries<string>(percentages).filter(([, v]) => v.trim()).map(([type, value]) => [type, numberValue(value, `${type}比例`, 100) / 100]));
                const overtimeTiers = tiers.map(t => {
                    const value = { minutes: numberValue(t.minutes, '級距分鐘'), numerator: numberValue(t.numerator, '倍率分子'), denominator: numberValue(t.denominator, '倍率分母') };
                    if (!Number.isInteger(value.minutes) || value.minutes <= 0 || value.numerator <= 0 || value.denominator <= 0) throw new Error('加班級距需填寫正整數分鐘與大於零的倍率');
                    return value;
                });
                const monthlyHourlyDivisor = monthly ? numberValue(divisor, '月薪換算時薪除數') : undefined;
                if (monthly && monthlyHourlyDivisor <= 0) throw new Error('月薪換算時薪除數必須大於零');
                const scheduleExceptions = [
                    ...(existing?.scheduleExceptions || []).filter(e => !gaps.some(g => g.date === e.date)),
                    ...gaps.filter(g => exceptions[g.date]?.checked).map(g => {
                        const reason = exceptions[g.date]?.reason?.trim();
                        if (!reason) throw new Error(`${g.date} 排班差異需要填寫核實原因`);
                        return { date: g.date, reason, sourceKey: g.sourceKey };
                    }),
                ];
                review = { yearMonth: month, scheduleExceptions,
                    policy: { version: version.trim(), hoursBasis: 'actual', dailyRegularMinutes: 480, workDateRule: 'clock-in-date', moneyDecimals: Number(precision) as 0 | 2,
                        regularDates: [...dates].sort(), overtimeTiers,
                        hourlyLeavePaidFraction: monthly ? existing?.policy?.hourlyLeavePaidFraction || {} : values,
                        monthlyLeaveDeductionFraction: monthly ? values : existing?.policy?.monthlyLeaveDeductionFraction || {},
                        ...(monthly ? { monthlyHourlyDivisor } : {}),
                    },
                    insurance: { labor: numberValue(insurance.labor, '勞保自付額'), health: numberValue(insurance.health, '健保自付額'), pensionSelf: numberValue(insurance.pensionSelf, '勞退自提額') },
                };
            }
            await apiReviewPayrollInputs(employee.id, review, employee.employeeSourceKey);
            await onSaved(); setSaved(true); setConfirmed(false);
        } catch (e: any) { setError(e.message || '計薪覆核儲存失敗'); }
        finally { setBusy(false); onBusyChange(false); }
    };
    return <form onSubmit={save} className="space-y-4" aria-label="月度計薪覆核">
        <p className="text-sm text-gray-600">{employee.name}（{employee.id}）｜{employee.position}｜{monthly ? '月薪' : '時薪'} {formatMoney(monthly ? employee.monthlySalary : employee.hourlyRate)}</p>
        {existing && <p className="text-sm text-gray-600">上次覆核：{existing.reviewedBy}，{existing.reviewedAt}</p>}
        {employee.accountKind === 'system-account' && <p className="rounded bg-gray-100 p-2 text-sm">此帳號已被明確分類為系統帳號，不列入計薪。</p>}
        <fieldset disabled={locked || busy} className="space-y-4">
            <label className="block text-sm"><input type="checkbox" checked={excluded} onChange={e => { setExcluded(e.target.checked); changed(); }} /> 本月為非受薪系統帳號，排除計薪</label>
            {excluded ? <label className="block text-sm">排除原因<input aria-label="排除原因" className={fieldClass} value={reason} onChange={e => { setReason(e.target.value); changed(); }} /></label> : <>
                <p className="rounded bg-amber-50 p-3 text-sm">以已核實的實際工作區間計薪，每日一般工時 8 小時，跨夜歸上班日。本版僅支援明確覆核的一般工作日；其他日別與未知政策維持待覆核。</p>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">政策版本／依據<input aria-label="政策版本／依據" className={fieldClass} value={version} onChange={e => { setVersion(e.target.value); changed(); }} placeholder="填入公司已確認的制度版本" /></label>
                    <label className="text-sm">結算金額精度<select aria-label="結算金額精度" className={fieldClass} value={precision} onChange={e => { setPrecision(e.target.value); changed(); }}><option value="">尚未確認</option><option value="0">整數元</option><option value="2">小數點後兩位</option></select></label>
                    {monthly && <label className="text-sm">月薪換算時薪除數<input aria-label="月薪換算時薪除數" className={fieldClass} type="number" min="0.01" step="any" value={divisor} onChange={e => { setDivisor(e.target.value); changed(); }} /></label>}
                </div>
                <div><h4 className="font-semibold">本月已確認的一般工作日</h4><p className="mb-2 text-sm text-gray-600">逐日勾選已核對的日期。未勾選的出勤或假單日期會保留待覆核。</p>
                    <div className="grid grid-cols-7 gap-2">{Array.from({ length: dayCount }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`).map(date => <label key={date} className="rounded border p-2 text-sm"><input aria-label={`一般工作日 ${date}`} type="checkbox" checked={dates.includes(date)} onChange={e => { setDates(e.target.checked ? [...dates, date] : dates.filter(d => d !== date)); changed(); }} /> {date.slice(-2)}</label>)}</div>
                </div>
                {gaps.length > 0 && <div className="space-y-3"><h4 className="font-semibold">排班與出勤證據的差異</h4><p className="text-sm text-gray-600">先調查缺卡；只有已核實未出勤或免出勤的差異，才填寫原因並確認。這不會補算班表工時。出勤或假單變動後須重新覆核。</p>{gaps.map(gap => <div key={`${gap.date}:${gap.sourceKey}`} className="rounded border bg-white p-3">
                    <p className="text-sm">{gap.date}：排班 {gap.scheduledMinutes / 60} 小時，已有證據覆蓋 {gap.coveredMinutes / 60} 小時</p>
                    <label className="block text-sm"><input type="checkbox" aria-label={`確認排班差異 ${gap.date}`} checked={exceptions[gap.date]?.checked || false} onChange={e => { setExceptions({ ...exceptions, [gap.date]: { reason: exceptions[gap.date]?.reason || '', checked: e.target.checked } }); changed(); }} /> 我已核實此日差異</label>
                    <input aria-label={`排班差異原因 ${gap.date}`} className={fieldClass} placeholder="填寫調查結果與未出勤／免出勤原因" value={exceptions[gap.date]?.reason || ''} onChange={e => { setExceptions({ ...exceptions, [gap.date]: { checked: false, reason: e.target.value } }); changed(); }} />
                </div>)}</div>}
                <div><h4 className="font-semibold">已確認的加班級距</h4><p className="mb-2 text-sm text-gray-600">依序填寫每一級距的分鐘與倍率分子／分母；未新增級距時，超過 8 小時的工作會保留待覆核。</p>
                    {tiers.map((tier, i) => <div className="mb-2 grid grid-cols-4 gap-2" key={i}>
                        {(['minutes', 'numerator', 'denominator'] as const).map((key, n) => <label key={key} className="text-sm">{['分鐘', '倍率分子', '倍率分母'][n]}<input aria-label={`加班級距 ${i + 1} ${['分鐘', '倍率分子', '倍率分母'][n]}`} className={fieldClass} type="number" min={key === 'minutes' ? '1' : '0.000001'} step={key === 'minutes' ? '1' : 'any'} value={tier[key]} onChange={e => { setTiers(tiers.map((t, index) => index === i ? { ...t, [key]: e.target.value } : t)); changed(); }} /></label>)}
                        <button type="button" className="rounded border text-sm" onClick={() => { setTiers(tiers.filter((_, n) => n !== i)); changed(); }}>移除級距</button>
                    </div>)}
                    <button type="button" className="rounded border px-3 py-1 text-sm" onClick={() => { setTiers([...tiers, { minutes: '', numerator: '', denominator: '' }]); changed(); }}>新增加班級距</button>
                </div>
                <div><h4 className="font-semibold">各假別／外勤的{monthly ? '扣薪' : '給薪'}比例（%）</h4><p className="mb-2 text-sm text-gray-600">填 0～100；空白表示尚未確認，涉及該類假單時不能結算。</p>
                    <div className="grid gap-3 sm:grid-cols-3">{Object.values(LeaveType).map(type => <label key={type} className="text-sm">{type}<input aria-label={`${type}${monthly ? '扣薪' : '給薪'}比例`} className={fieldClass} type="number" min="0" max="100" step="any" value={percentages[type] || ''} onChange={e => { setPercentages({ ...percentages, [type]: e.target.value }); changed(); }} /></label>)}</div>
                </div>
                <div><h4 className="font-semibold">本月個人保費與自提金額</h4><p className="mb-2 text-sm text-gray-600">依本月已確認金額填寫；確定無須扣款時請明確填 0。</p>
                    <div className="grid gap-3 sm:grid-cols-3">{(['labor', 'health', 'pensionSelf'] as const).map((key, i) => <label key={key} className="text-sm">{['勞保自付額', '健保自付額', '勞退自提額'][i]}<input aria-label={['勞保自付額', '健保自付額', '勞退自提額'][i]} className={fieldClass} type="number" min="0" step="any" value={insurance[key]} onChange={e => { setInsurance({ ...insurance, [key]: e.target.value }); changed(); }} /></label>)}</div>
                </div>
            </>}
            <label className="block text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> {excluded ? '我已確認此帳號本月不參與計薪及排除原因' : '我已逐項核對本月公司政策、一般工作日與個人保費'}</label>
            <button type="submit" disabled={!confirmed} className="rounded bg-green-700 px-4 py-2 text-white disabled:opacity-50">{busy ? '儲存中…' : '儲存計薪覆核'}</button>
        </fieldset>
        {error && <p role="alert" className="text-red-700">{error}</p>}
    </form>;
};

const PayrollReviewPanel: React.FC<{ month: string; locked: boolean; settling: boolean; onSaved: () => Promise<void>; onBusyChange: (busy: boolean) => void }> = ({ month, locked, settling, onSaved, onBusyChange }) => {
    const [inputs, setInputs] = useState<PayrollReviewInputs | null>(null);
    const [selected, setSelected] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [mutating, setMutating] = useState(false);
    const [notice, setNotice] = useState('');
    const currentMonth = useRef(month);
    currentMonth.current = month;
    useEffect(() => {
        let active = true; setLoading(true); setError(''); setInputs(null);
        apiGetPayrollReviewInputs(month).then(data => { if (active) { setInputs(data); setSelected(data.employees[0]?.id || ''); } }).catch(e => { if (active) setError(e.message || '覆核資料讀取失敗'); }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [month]);
    const refreshed = async (message: string) => {
        if (currentMonth.current !== month) return;
        const data = await apiGetPayrollReviewInputs(month);
        if (currentMonth.current !== month) return;
        setInputs(data);
        await onSaved();
        if (currentMonth.current === month) setNotice(message);
    };
    const mutationBusy = (value: boolean) => { setMutating(value); onBusyChange(value); };
    const employee = inputs?.employees.find(e => e.id === selected);
    const readOnly = locked || settling || !!inputs?.locked;
    return <section className="mb-6 space-y-4 rounded-lg border border-blue-200 bg-blue-50 p-4" aria-label="計薪資料覆核">
        <h3 className="text-lg font-bold">{month} 計薪資料覆核</h3>
        <p className="text-sm text-gray-700">依序完成個人薪制與保費、出勤工作區間、核准假單時段；薪資仍顯示待覆核時，請依原因逐項處理。保存設定不代表已完成月結。</p>
        {loading && <p>讀取覆核資料中…</p>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {(locked || inputs?.locked) && <p role="status" className="rounded bg-amber-100 p-3">本月已鎖定，覆核資料僅供查閱；不能修改或重新計薪。</p>}
        {settling && <p role="status" className="rounded bg-amber-100 p-3">本月正在結算，暫停修改覆核資料。</p>}
        {inputs && <label className="block text-sm">覆核員工<select aria-label="覆核員工" disabled={mutating} className={fieldClass} value={selected} onChange={e => setSelected(e.target.value)}>{inputs.employees.map(e => <option key={e.id} value={e.id}>{e.name}（{e.id}）</option>)}</select></label>}
        {notice && <p role="status" className="text-green-700">{notice}</p>}
        {employee && <EmployeeReviewForm key={`${month}:${employee.id}:${employee.employeeSourceKey}:${JSON.stringify(employee.payrollReview || null)}:${JSON.stringify(inputs.scheduleGaps || [])}`} employee={employee} month={month} gaps={(inputs.scheduleGaps || []).filter(g => g.empId === employee.id)} locked={readOnly || mutating} onSaved={() => refreshed('計薪覆核已儲存，薪資已重新檢查；其餘待覆核項目仍需處理。')} onBusyChange={mutationBusy} />}
        {employee && <div className="space-y-3"><h3 className="font-semibold">已核准假單／外勤的逐日時段</h3>{inputs.leaves.filter(l => l.empId === employee.id).map(l => <LeaveAllocationEditor key={`${month}:${l.id}`} leave={l} locked={readOnly || mutating} onSaved={() => refreshed('請假時段已儲存，薪資已重新檢查。')} onBusyChange={mutationBusy} />)}{!inputs.leaves.some(l => l.empId === employee.id) && <p className="text-sm text-gray-600">本月沒有需要分配的已核准假單。</p>}</div>}
    </section>;
};

export default PayrollReviewPanel;
