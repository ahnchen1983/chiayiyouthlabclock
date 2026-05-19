import React, { useState } from 'react';
import { apiDisableTotp } from '../services/googleAppsScriptAPI';

interface Props {
    onClose: () => void;
    onDisabled: () => void;
}

const TotpDisableModal: React.FC<Props> = ({ onClose, onDisabled }) => {
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            await apiDisableTotp(code);
            onDisabled();
            onClose();
        } catch (e: any) {
            setError(e?.message || '停用失敗');
            setCode('');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-gray-800">停用雙因素驗證</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
                </div>
                <div className="p-3 bg-amber-50 border border-amber-300 rounded text-sm text-amber-900 mb-4">
                    停用後您的帳號將只用密碼登入，安全強度會降低。
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm text-gray-700 mb-1">請輸入當前 6 位數驗證碼確認：</label>
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
                    </div>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <div className="flex gap-2">
                        <button type="button" onClick={onClose} className="flex-1 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">
                            取消
                        </button>
                        <button
                            type="submit"
                            disabled={busy || code.length !== 6}
                            className="flex-1 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-gray-400"
                        >
                            {busy ? '處理中…' : '確認停用'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default TotpDisableModal;
