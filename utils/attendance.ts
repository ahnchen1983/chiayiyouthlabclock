import type { ClockRecord, ScheduleEvent, StaffShift } from '../types';

export const ATTENDANCE_VERSION = 'attendance-v2';
export const TAIPEI_ZONE = 'Asia/Taipei';
export const taipeiDate = (date: Date = new Date()): string => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: TAIPEI_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    return `${p.find(x => x.type === 'year')!.value}-${p.find(x => x.type === 'month')!.value}-${p.find(x => x.type === 'day')!.value}`;
};
export const taipeiTime = (date: Date = new Date()): string => date.toLocaleTimeString('en-GB', { timeZone: TAIPEI_ZONE, hour: '2-digit', minute: '2-digit' });
export const validDate = (date: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(date || '') && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
export const hhmmMinutes = (value: string | null | undefined): number | null => {
    if (!value || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) return null;
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
};
// Daily leave allocations may end exactly at the next midnight. Starts and
// clock timestamps retain their normal 00:00–23:59 validation.
export const leaveEndMinutes = (value: string | null | undefined): number | null => value === '24:00' ? 1440 : hhmmMinutes(value);
export const localInstant = (date: string, time: string | null | undefined): string | null => {
    if (!validDate(date) || hhmmMinutes(time) === null) return null;
    return new Date(`${date}T${time!.slice(0, 5)}:00+08:00`).toISOString();
};
export type Interval = { start: number; end: number };
export const parseWorkIntervals = (text: string): Interval[] => {
    const parse = (value: string): number => {
        const match = /^([0-2]\d:[0-5]\d)(\+1)?$/.exec(value.trim());
        const minutes = match ? hhmmMinutes(match[1]) : null;
        if (minutes === null) throw new Error('工作時段格式：09:00-12:00,14:00-18:00；翌日起訖可加 +1');
        return minutes + (match[2] ? 1440 : 0);
    };
    if (!text.trim()) return [];
    return text.split(',').map(part => {
        const sides = part.trim().split('-');
        if (sides.length !== 2) throw new Error('每段工作時段需要起點與終點');
        const start = parse(sides[0]), end = parse(sides[1]);
        if (end <= start) throw new Error('工作時段結束必須晚於開始；翌日時間請加 +1');
        return { start, end };
    });
};
export const formatWorkIntervals = (ranges: Interval[]): string => {
    const time = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}${n >= 1440 ? '+1' : ''}`;
    return ranges.map(r => `${time(r.start)}-${time(r.end)}`).join(',');
};
export const unionIntervals = (ranges: Interval[]): Interval[] => {
    const sorted = ranges.filter(x => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start).map(x => ({ ...x })).sort((a, b) => a.start - b.start);
    const result: Interval[] = [];
    for (const r of sorted) {
        const last = result[result.length - 1];
        if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
        else result.push(r);
    }
    return result;
};
export const intervalMinutes = (ranges: Interval[]): number => unionIntervals(ranges).reduce((n, r) => n + r.end - r.start, 0);
export const shiftIntervals = (shifts: Pick<StaffShift, 'from' | 'to' | 'endDateOffset'>[]): Interval[] | null => {
    const ranges: Interval[] = [];
    for (const s of shifts) {
        const start = hhmmMinutes(s.from), end = hhmmMinutes(s.to);
        if (start === null || end === null || (s.endDateOffset !== undefined && s.endDateOffset !== 0 && s.endDateOffset !== 1)) return null;
        const finish = end + (s.endDateOffset || 0) * 1440;
        // Legacy HH:mm overnight must be reviewed; never guess which date.
        if (finish <= start || finish - start > 1440) return null;
        ranges.push({ start, end: finish });
    }
    return unionIntervals(ranges);
};
export const clockInterval = (record: Pick<ClockRecord, 'date' | 'clockInTime' | 'clockOutTime' | 'clockInAt' | 'clockOutAt'>): Interval | null => {
    const inAt = record.clockInAt, outAt = record.clockOutAt;
    if (inAt || outAt) {
        if (!inAt || !outAt || !/(Z|[+-]\d\d:\d\d)$/.test(inAt) || !/(Z|[+-]\d\d:\d\d)$/.test(outAt) || !validDate(record.date)) return null;
        const epoch = Date.parse(`${record.date}T00:00:00+08:00`);
        const start = Math.floor((Date.parse(inAt) - epoch) / 60000), end = Math.floor((Date.parse(outAt) - epoch) / 60000);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 1440 || start < 0 || start >= 1440) return null;
        return { start, end };
    }
    const start = hhmmMinutes(record.clockInTime), end = hhmmMinutes(record.clockOutTime);
    return start !== null && end !== null && end > start ? { start, end } : null;
};
export const resolveAttendance = (record: Pick<ClockRecord, 'date' | 'clockInTime' | 'clockOutTime' | 'clockInAt' | 'clockOutAt'>, shifts: Pick<StaffShift, 'from' | 'to' | 'endDateOffset'>[] = []) => {
    const range = clockInterval(record), schedule = shiftIntervals(shifts);
    const reasons: string[] = [];
    if (!range) reasons.push('缺卡、無效時間或舊跨夜紀錄待核實');
    if (schedule === null) reasons.push('班次日期或跨夜資訊待核實');
    const rawMinutes = range ? range.end - range.start : null;
    const scheduledMinutes = schedule === null ? null : intervalMinutes(schedule);
    const payableMinutes = range && schedule !== null ? (schedule.length ? intervalMinutes(schedule.map(s => ({ start: Math.max(s.start, range.start), end: Math.min(s.end, range.end) }))) : rawMinutes) : null;
    return { version: ATTENDANCE_VERSION, rawMinutes, scheduledMinutes, payableMinutes, reviewReasons: reasons, workHours: payableMinutes === null ? null : payableMinutes / 60 };
};
export const clockSourceKey = (r: Pick<ClockRecord, 'date' | 'clockInTime' | 'clockOutTime' | 'clockInAt' | 'clockOutAt'>): string => JSON.stringify([r.date, r.clockInTime, r.clockOutTime, r.clockInAt || null, r.clockOutAt || null]);
export const confirmedWork = (r: ClockRecord): Interval[] | null => {
    const span = clockInterval(r);
    if (!span || !r.workReview?.reviewedBy || !r.workReview.reviewedAt || r.workReview.sourceKey !== clockSourceKey(r) || !Array.isArray(r.workIntervals)) return null;
    if (r.workIntervals.some(i => !i || typeof i !== 'object' || Array.isArray(i) || !Number.isInteger(i.start) || !Number.isInteger(i.end) || i.end <= i.start || i.start < span.start || i.end > span.end)) return null;
    return unionIntervals(r.workIntervals);
};
export const resolveClockRecord = (record: ClockRecord, _events: ScheduleEvent[] = []): ClockRecord => {
    const span = clockInterval(record), work = confirmedWork(record);
    return { ...record, rawMinutes: span ? span.end - span.start : null,
        payableMinutes: work === null ? null : intervalMinutes(work),
        workHours: work === null ? null : intervalMinutes(work) / 60,
        reviewReasons: work === null ? ['缺卡、實際工作/休息區間或跨夜資訊待覆核'] : [],
        calculationVersion: ATTENDANCE_VERSION };
};
export const sumKnownHours = (records: ClockRecord[]): number | null => records.some(r => r.workHours == null) ? null : records.reduce((n, r) => n + r.workHours!, 0);

// Display-only daily rollup. Payroll still consumes individual reviewed sessions.
export const dailyClockRecord = (records: ClockRecord[]): ClockRecord | undefined => {
    if (!records.length) return undefined;
    const sorted = [...records].sort((a,b)=>(a.clockInAt || a.clockInTime || '').localeCompare(b.clockInAt || b.clockInTime || ''));
    const first = sorted[0], last = sorted[sorted.length-1];
    const hours = sumKnownHours(sorted);
    return { ...first, clockInTime: sorted.some(r=>!r.clockInTime)?null:first.clockInTime,
        clockOutTime: sorted.some(r=>!r.clockOutTime)?null:last.clockOutTime,
        clockOutAt: last.clockOutAt || null, workHours: hours, payableMinutes: hours===null?null:hours*60 };
};
export const scheduleMonthKeys = (event: Pick<ScheduleEvent,'date'|'shifts'>): string[] => {
    if (!validDate(event.date)) throw new Error('班表日期無效');
    const keys=[event.date.slice(0,7)];
    if(event.shifts.some(s=>s.endDateOffset===1)) { const next=new Date(event.date+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);keys.push(next.toISOString().slice(0,7)); }
    return [...new Set(keys)];
};
