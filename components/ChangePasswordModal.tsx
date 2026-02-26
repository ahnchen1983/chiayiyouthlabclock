import React, { useState } from 'react';
import { apiChangePassword } from '../services/googleAppsScriptAPI';
import { useAuth } from '../contexts/AuthContext';

interface ChangePasswordModalProps {
    onClose: () => void;
}

const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ onClose }) => {
    const { user } = useAuth();
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (newPassword !== confirmPassword) {
            setError('新密碼與確認密碼不相符');
            return;
        }

        if (newPassword.length < 4) {
            setError('新密碼至少需要 4 個字元');
            return;
        }

        if (oldPassword === newPassword) {
            setError('新密碼不能與舊密碼相同');
            return;
        }

        if (!user) return;

        setLoading(true);
        try {
            const res = await apiChangePassword(user.id, oldPassword, newPassword);
            if (res.success) {
                alert('密碼修改成功，下次請使用新密碼登入。');
                onClose();
            } else {
                setError(res.message);
            }
        } catch (err) {
            setError('發生錯誤，請稍後再試。');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
                <h3 className="text-lg font-bold text-gray-800 mb-4">修改密碼</h3>
                <form onSubmit={handleSubmit}>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                舊密碼 <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="password"
                                value={oldPassword}
                                onChange={(e) => setOldPassword(e.target.value)}
                                required
                                className="w-full p-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                placeholder="輸入目前的密碼"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                新密碼 <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                required
                                minLength={4}
                                className="w-full p-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                placeholder="至少 4 個字元"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                確認新密碼 <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                                minLength={4}
                                className="w-full p-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                placeholder="再次輸入新密碼"
                            />
                        </div>
                    </div>

                    {error && <p className="text-sm text-red-500 mt-4">{error}</p>}

                    <div className="flex justify-end gap-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200"
                            disabled={loading}
                        >
                            取消
                        </button>
                        <button
                            type="submit"
                            className="flex items-center justify-center px-4 py-2 text-white bg-blue-500 rounded-md hover:bg-blue-600 disabled:bg-blue-300 min-w-[80px]"
                            disabled={loading}
                        >
                            {loading ? (
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                                '確認修改'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ChangePasswordModal;
