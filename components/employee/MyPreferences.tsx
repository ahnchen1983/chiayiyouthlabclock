import React, { useEffect, useMemo, useState } from 'react';
import {
    apiGetMyStaffPreference,
    apiUpdateMyStaffPreference,
} from '../../services/googleAppsScriptAPI';

const WEEKDAYS = [
    { value: 0, label: '日' },
    { value: 1, label: '一' },
    { value: 2, label: '二' },
    { value: 3, label: '三' },
    { value: 4, label: '四' },
    { value: 5, label: '五' },
    { value: 6, label: '六' },
];

const sortUnique = (dates: string[]) => Array.from(new Set(dates)).sort();

const DateListEditor: React.FC<{
    title: string;
    value: string[];
    tone: 'red' | 'green';
    onChange: (dates: string[]) => void;
}> = ({ title, value, tone, onChange }) => {
    const [draft, setDraft] = useState('');
    const toneClass = tone === 'red'
        ? 'bg-red-50 border-red-200 text-red-700'
        : 'bg-green-50 border-green-200 text-green-700';

    const addDate = () => {
        if (!draft) return;
        onChange(sortUnique([...value, draft]));
        setDraft('');
    };

    return (
        <section className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="font-semibold text-gray-800">{title}</h3>
                <span className="text-xs text-gray-400">{value.length}/200</span>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
                <input
                    type="date"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    className="border rounded px-3 py-2 text-sm"
                />
                <button
                    type="button"
                    onClick={addDate}
                    className="px-3 py-2 text-sm rounded bg-gray-800 text-white hover:bg-gray-700"
                >
                    新增
                </button>
            </div>
            {value.length === 0 ? (
                <p className="text-sm text-gray-400 py-3">尚未設定日期</p>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {value.map(date => (
                        <span key={date} className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs ${toneClass}`}>
                            {date}
                            <button
                                type="button"
                                onClick={() => onChange(value.filter(item => item !== date))}
                                className="font-bold hover:text-gray-900"
                                aria-label={`移除 ${date}`}
                            >
                                ×
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </section>
    );
};

const MyPreferences: React.FC = () => {
    const [blockedWeekdays, setBlockedWeekdays] = useState<number[]>([]);
    const [blockedDates, setBlockedDates] = useState<string[]>([]);
    const [preferredDates, setPreferredDates] = useState<string[]>([]);
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
        let alive = true;
        const load = async () => {
            try {
                const pref = await apiGetMyStaffPreference();
                if (!alive) return;
                setBlockedWeekdays(pref.blockedWeekdays || []);
                setBlockedDates(pref.blockedDates || []);
                setPreferredDates(pref.preferredDates || []);
                setNote(pref.note || '');
            } catch (e: any) {
                if (alive) setMessage(e?.message || '讀取偏好失敗');
            } finally {
                if (alive) setLoading(false);
            }
        };
        load();
        return () => { alive = false; };
    }, []);

    const overlapDates = useMemo(() => {
        const preferredSet = new Set(preferredDates);
        return blockedDates.filter(date => preferredSet.has(date));
    }, [blockedDates, preferredDates]);

    const toggleWeekday = (day: number) => {
        setBlockedWeekdays(prev => (
            prev.includes(day)
                ? prev.filter(item => item !== day)
                : [...prev, day].sort((a, b) => a - b)
        ));
    };

    const handleSave = async () => {
        setMessage('');
        if (note.length > 200) {
            setMessage('備註不可超過 200 字');
            return;
        }
        if (overlapDates.length > 0) {
            setMessage(`${overlapDates[0]} 同時出現在不可上與偏好上，請擇一`);
            return;
        }
        setSaving(true);
        try {
            const saved = await apiUpdateMyStaffPreference({
                blockedWeekdays,
                blockedDates,
                preferredDates,
                note,
            });
            setBlockedWeekdays(saved.blockedWeekdays || []);
            setBlockedDates(saved.blockedDates || []);
            setPreferredDates(saved.preferredDates || []);
            setNote(saved.note || '');
            setMessage('偏好設定已儲存');
        } catch (e: any) {
            setMessage(e?.message || '儲存失敗');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="p-6 bg-white rounded-lg shadow text-center text-gray-400">載入中...</div>;
    }

    return (
        <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-6">
            <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-800">偏好設定</h2>
                <p className="text-sm text-gray-500 mt-1">排班時提供管理者提醒，實際排班仍以現場需求為準。</p>
            </div>

            <section className="mb-5 border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-gray-800 mb-3">固定不可上班星期</h3>
                <div className="grid grid-cols-7 gap-2">
                    {WEEKDAYS.map(day => (
                        <label
                            key={day.value}
                            className={`flex flex-col items-center justify-center gap-2 rounded border p-3 cursor-pointer transition-colors ${
                                blockedWeekdays.includes(day.value)
                                    ? 'bg-red-50 border-red-300 text-red-700'
                                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            <input
                                type="checkbox"
                                checked={blockedWeekdays.includes(day.value)}
                                onChange={() => toggleWeekday(day.value)}
                                className="h-4 w-4"
                            />
                            <span className="text-sm font-medium">週{day.label}</span>
                        </label>
                    ))}
                </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
                <DateListEditor title="特定不可上班日期" value={blockedDates} tone="red" onChange={setBlockedDates} />
                <DateListEditor title="偏好上班日期" value={preferredDates} tone="green" onChange={setPreferredDates} />
            </div>

            <section className="mb-5">
                <div className="flex items-center justify-between mb-2">
                    <label className="font-semibold text-gray-800" htmlFor="preference-note">備註</label>
                    <span className={`text-xs ${note.length > 200 ? 'text-red-600' : 'text-gray-400'}`}>{note.length}/200</span>
                </div>
                <textarea
                    id="preference-note"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={4}
                    maxLength={220}
                    className="w-full border rounded-lg p-3 text-sm focus:ring-2 focus:ring-brand-green-dark focus:border-transparent"
                    placeholder="例如：暑假期間週五可彈性支援"
                />
            </section>

            {overlapDates.length > 0 && (
                <p className="mb-4 text-sm text-red-600">⚠️ {overlapDates[0]} 同時出現在不可上與偏好上，請擇一。</p>
            )}
            {message && (
                <p className={`mb-4 text-sm ${message.includes('已儲存') ? 'text-green-700' : 'text-red-600'}`}>{message}</p>
            )}

            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="px-5 py-2.5 rounded bg-brand-blue-dark text-white hover:bg-blue-700 disabled:opacity-50"
                >
                    {saving ? '儲存中...' : '儲存偏好'}
                </button>
            </div>
        </div>
    );
};

export default MyPreferences;
