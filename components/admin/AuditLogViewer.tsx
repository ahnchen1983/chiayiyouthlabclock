import React, { useState, useEffect } from 'react';
import { apiGetAuditLogs, AuditLog } from '../../services/googleAppsScriptAPI';

const AuditLogViewer: React.FC = () => {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchLogs = async () => {
            try {
                const data = await apiGetAuditLogs(200);
                setLogs(data);
            } catch (e: any) {
                setError(e.message || '無法載入稽核日誌');
            }
            setLoading(false);
        };
        fetchLogs();
    }, []);

    if (loading) return <div className="text-center py-10">載入中...</div>;
    if (error) return <div className="text-center py-10 text-red-600">{error}</div>;

    return (
        <div className="p-4 bg-white rounded-lg shadow-lg">
            <h1 className="text-3xl font-bold text-gray-800 mb-4">系統稽核日誌</h1>
            <p className="text-sm text-gray-500 mb-4">記錄所有管理操作，最近 200 筆</p>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-gray-50 border-b">
                            <th className="p-3 text-left">時間</th>
                            <th className="p-3 text-left">操作者</th>
                            <th className="p-3 text-left">操作</th>
                            <th className="p-3 text-left">對象</th>
                            <th className="p-3 text-left">詳情</th>
                        </tr>
                    </thead>
                    <tbody>
                        {logs.map(log => (
                            <tr key={log.id} className="border-b hover:bg-gray-50">
                                <td className="p-3 whitespace-nowrap">{new Date(log.timestamp).toLocaleString('zh-TW')}</td>
                                <td className="p-3">{log.userId}</td>
                                <td className="p-3">
                                    <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">{log.action}</span>
                                </td>
                                <td className="p-3">{log.targetId}</td>
                                <td className="p-3 text-gray-500 max-w-xs truncate">{log.details}</td>
                            </tr>
                        ))}
                        {logs.length === 0 && (
                            <tr><td colSpan={5} className="p-6 text-center text-gray-400">尚無操作紀錄</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default AuditLogViewer;
