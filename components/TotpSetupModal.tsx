import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { apiSetupTotp, apiVerifyTotpSetup } from '../services/googleAppsScriptAPI';

interface Props {
    onClose: () => void;
    /** SuperAdmin 強制啟用模式：不顯示 X、不顯示「稍後再說」 */
    forced?: boolean;
    /** 啟用完成後回呼（讓父層更新 needsTotpSetup） */
    onCompleted?: () => void;
}

type Step = 'intro' | 'scan' | 'verify' | 'recovery';

const TotpSetupModal: React.FC<Props> = ({ onClose, forced, onCompleted }) => {
    const [step, setStep] = useState<Step>('intro');
    const [secret, setSecret] = useState('');
    const [otpauthUrl, setOtpauthUrl] = useState('');
    const [qrDataUrl, setQrDataUrl] = useState('');
    const [code, setCode] = useState('');
    const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
    const [acknowledged, setAcknowledged] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (step === 'scan' && otpauthUrl) {
            QRCode.toDataURL(otpauthUrl, { width: 240, margin: 1 })
                .then(setQrDataUrl)
                .catch(() => setError('QR Code 產生失敗，請使用「手動輸入金鑰」'));
        }
    }, [step, otpauthUrl]);

    const startSetup = async () => {
        setBusy(true);
        setError('');
        try {
            const r = await apiSetupTotp();
            setSecret(r.secret);
            setOtpauthUrl(r.otpauthUrl);
            setStep('scan');
        } catch (e: any) {
            setError(e?.message || '啟動 2FA 失敗');
        } finally {
            setBusy(false);
        }
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            const r = await apiVerifyTotpSetup(code);
            setRecoveryCodes(r.recoveryCodes);
            setStep('recovery');
        } catch (e: any) {
            setError(e?.message || '驗證碼錯誤');
            setCode('');
        } finally {
            setBusy(false);
        }
    };

    const copyRecovery = () => {
        navigator.clipboard.writeText(recoveryCodes.join('\n'))
            .then(() => alert('已複製到剪貼簿'))
            .catch(() => alert('複製失敗，請手動選取'));
    };

    const handleDone = () => {
        onCompleted?.();
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-gray-800">設定雙因素驗證 (2FA)</h2>
                    {!forced && (
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
                    )}
                </div>

                {step === 'intro' && (
                    <div className="space-y-4">
                        {forced && (
                            <div className="p-3 bg-amber-50 border border-amber-300 rounded text-sm text-amber-900">
                                <strong>最高管理者帳號必須啟用 2FA 才能進入系統。</strong>
                            </div>
                        )}
                        <p className="text-sm text-gray-700">
                            雙因素驗證 (2FA) 在密碼之外加上一道驗證關卡。即使密碼外洩，攻擊者仍需取得您手機的 6 位數驗證碼才能登入。
                        </p>
                        <p className="text-sm text-gray-700">
                            您需要先在手機安裝 <strong>Google Authenticator</strong>、<strong>Microsoft Authenticator</strong> 或 <strong>1Password</strong> 等 TOTP App。
                        </p>
                        {error && <p className="text-sm text-red-600">{error}</p>}
                        <button
                            onClick={startSetup}
                            disabled={busy}
                            className="w-full py-2 bg-brand-green-dark text-white rounded hover:bg-brand-green-light disabled:bg-gray-400"
                        >
                            {busy ? '產生金鑰中…' : '開始設定'}
                        </button>
                        {!forced && (
                            <button onClick={onClose} className="w-full py-2 text-sm text-gray-500 hover:underline">
                                稍後再說
                            </button>
                        )}
                    </div>
                )}

                {step === 'scan' && (
                    <div className="space-y-4">
                        <p className="text-sm text-gray-700">用手機 App 掃描下方 QR Code：</p>
                        <div className="flex justify-center bg-gray-50 p-3 rounded">
                            {qrDataUrl
                                ? <img src={qrDataUrl} alt="TOTP QR Code" className="w-60 h-60" />
                                : <div className="w-60 h-60 flex items-center justify-center text-gray-400">產生中…</div>}
                        </div>
                        <details className="text-xs text-gray-600">
                            <summary className="cursor-pointer hover:text-brand-green-dark">無法掃描？手動輸入金鑰</summary>
                            <div className="mt-2 p-2 bg-gray-50 rounded font-mono break-all select-all">
                                {secret}
                            </div>
                            <p className="mt-1">類型：時間制 (TOTP) / 演算法：SHA-1 / 位數：6 / 週期：30 秒</p>
                        </details>
                        {error && <p className="text-sm text-red-600">{error}</p>}
                        <button
                            onClick={() => { setStep('verify'); setError(''); }}
                            className="w-full py-2 bg-brand-green-dark text-white rounded hover:bg-brand-green-light"
                        >
                            下一步：輸入驗證碼
                        </button>
                    </div>
                )}

                {step === 'verify' && (
                    <form onSubmit={handleVerify} className="space-y-4">
                        <p className="text-sm text-gray-700">請輸入 App 顯示的 6 位數驗證碼：</p>
                        <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            required
                            value={code}
                            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                            className="w-full py-3 text-center text-2xl tracking-widest border border-gray-300 rounded focus:outline-none focus:ring-brand-green-dark focus:border-brand-green-dark"
                            placeholder="------"
                            autoFocus
                        />
                        {error && <p className="text-sm text-red-600">{error}</p>}
                        <button
                            type="submit"
                            disabled={busy || code.length !== 6}
                            className="w-full py-2 bg-brand-green-dark text-white rounded hover:bg-brand-green-light disabled:bg-gray-400"
                        >
                            {busy ? '驗證中…' : '驗證'}
                        </button>
                        <button type="button" onClick={() => setStep('scan')} className="w-full py-2 text-sm text-gray-500 hover:underline">
                            ← 回 QR Code
                        </button>
                    </form>
                )}

                {step === 'recovery' && (
                    <div className="space-y-4">
                        <div className="p-3 bg-red-50 border border-red-300 rounded">
                            <p className="text-sm font-semibold text-red-800">
                                ⚠️ 請務必保存以下 10 組備援碼
                            </p>
                            <p className="text-xs text-red-700 mt-1">
                                這些碼是您遺失手機時的唯一救援。**離開此畫面後將無法再次查看**。
                                每組碼只能用一次。
                            </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 p-3 bg-gray-50 rounded font-mono text-center text-sm">
                            {recoveryCodes.map((c, i) => (
                                <div key={i} className="py-1 bg-white border rounded select-all">{c}</div>
                            ))}
                        </div>
                        <button
                            onClick={copyRecovery}
                            className="w-full py-2 text-sm border border-brand-green-dark text-brand-green-dark rounded hover:bg-green-50"
                        >
                            📋 複製全部
                        </button>
                        <label className="flex items-start gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={acknowledged}
                                onChange={e => setAcknowledged(e.target.checked)}
                                className="mt-1 w-4 h-4"
                            />
                            <span>我已將備援碼妥善備份（紙本或密碼管理器）</span>
                        </label>
                        <button
                            onClick={handleDone}
                            disabled={!acknowledged}
                            className="w-full py-2 bg-brand-green-dark text-white rounded hover:bg-brand-green-light disabled:bg-gray-400"
                        >
                            完成
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TotpSetupModal;
