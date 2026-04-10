import React, { useEffect, useState } from 'react';
import { apiGetSystemConfig, apiUpdateSystemConfig } from '../../services/googleAppsScriptAPI';
import { SystemConfig } from '../../types';

const defaultConfig: SystemConfig = {
    laborInsuranceRate: 0.023,
    healthInsuranceRate: 0.0211,
    laborPensionRate: 0.06,
    overtimeMultiplier: 1.34,
    ptMonthlyHourLimit: 80,
    ptWarningThreshold: 70,
    lateGraceMinutes: 5,
};

const SystemSettings: React.FC = () => {
    const [config, setConfig] = useState<SystemConfig>(defaultConfig);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const cfg = await apiGetSystemConfig();
                setConfig(cfg);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const update = (k: keyof SystemConfig, v: number) => setConfig(prev => ({ ...prev, [k]: v }));

    const handleSave = async () => {
        setSaving(true);
        setMsg(null);
        try {
            const updated = await apiUpdateSystemConfig(config);
            setConfig(updated);
            setMsg('已儲存');
        } catch (e: any) {
            setMsg(e.message || '儲存失敗');
        } finally {
            setSaving(false);
            setTimeout(() => setMsg(null), 3000);
        }
    };

    if (loading) return <div className="p-6">載入中…</div>;

    const Field: React.FC<{ label: string; k: keyof SystemConfig; step?: string; suffix?: string; hint?: string }>
        = ({ label, k, step = '0.001', suffix, hint }) => (
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            <div className="flex items-center gap-2">
                <input
                    type="number"
                    step={step}
                    value={config[k] as number}
                    onChange={e => update(k, Number(e.target.value))}
                    className="w-full p-2 border rounded"
                />
                {suffix && <span className="text-sm text-gray-500">{suffix}</span>}
            </div>
            {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
        </div>
    );

    return (
        <div className="p-6 bg-white rounded-lg shadow-lg">
            <h1 className="text-2xl font-bold text-gray-800 mb-6">系統設定</h1>
            <p className="text-sm text-gray-500 mb-6">薪資費率、兼職時數上限與遲到寬限等共用設定。修改後立即影響後續的薪資計算與遲到判定。</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Field label="勞保費率（員工負擔）" k="laborInsuranceRate" suffix="(0.023 = 2.3%)" />
                <Field label="健保費率（員工負擔）" k="healthInsuranceRate" suffix="(0.0211 = 2.11%)" />
                <Field label="勞退自提率" k="laborPensionRate" suffix="(0.06 = 6%)" />
                <Field label="加班倍率" k="overtimeMultiplier" step="0.01" suffix="(1.34 = 134%)" />
                <Field label="兼職月時數上限" k="ptMonthlyHourLimit" step="1" suffix="小時" />
                <Field label="兼職時數警示閾值" k="ptWarningThreshold" step="1" suffix="小時" hint="超過此時數即顯示警示" />
                <Field label="遲到寬限分鐘" k="lateGraceMinutes" step="1" suffix="分鐘" hint="打卡時間在排班開始時間 +N 分鐘內視為正常" />
            </div>

            <div className="mt-8 flex items-center gap-4">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                >
                    {saving ? '儲存中…' : '儲存設定'}
                </button>
                {msg && <span className="text-sm text-gray-600">{msg}</span>}
            </div>

            {config.updatedAt && (
                <p className="mt-4 text-xs text-gray-400">最後更新：{new Date(config.updatedAt).toLocaleString('zh-TW')}（{config.updatedBy}）</p>
            )}
        </div>
    );
};

export default SystemSettings;
