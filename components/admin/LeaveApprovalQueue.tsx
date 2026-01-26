
import React, { useState, useEffect, useCallback } from 'react';
import { apiGetAllLeaveRequests, apiApproveLeave } from '../../services/googleAppsScriptAPI';
import { LeaveRequest, LeaveStatus } from '../../types';
import { useAuth } from '../../contexts/AuthContext';

const LeaveApprovalQueue: React.FC = () => {
    const { user } = useAuth();
    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<LeaveStatus>(LeaveStatus.Pending);

    const fetchRequests = useCallback(async () => {
        setLoading(true);
        const data = await apiGetAllLeaveRequests();
        setRequests(data);
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchRequests();
    }, [fetchRequests]);

    const handleApproval = async (requestId: string, newStatus: LeaveStatus.Approved | LeaveStatus.Rejected) => {
        if (!user) return;
        await apiApproveLeave(requestId, newStatus, user.name);
        await fetchRequests(); // Refresh list
    };
    
    const filteredRequests = requests.filter(r => r.status === filter);

    const getStatusChipClass = (status: LeaveStatus) => {
        switch(status) {
            case LeaveStatus.Approved: return 'bg-green-100 text-green-800';
            case LeaveStatus.Rejected: return 'bg-red-100 text-red-800';
            case LeaveStatus.Pending: return 'bg-yellow-100 text-yellow-800';
        }
    }

    return (
        <div className="p-4 bg-white rounded-lg shadow-lg">
            <h1 className="text-3xl font-bold text-gray-800 mb-4">請假審核</h1>
            
            <div className="flex space-x-2 mb-4 border-b">
                <button onClick={() => setFilter(LeaveStatus.Pending)} className={`py-2 px-4 font-semibold ${filter === LeaveStatus.Pending ? 'border-b-2 border-brand-blue-dark text-brand-blue-dark' : 'text-gray-500'}`}>待審核</button>
                <button onClick={() => setFilter(LeaveStatus.Approved)} className={`py-2 px-4 font-semibold ${filter === LeaveStatus.Approved ? 'border-b-2 border-brand-blue-dark text-brand-blue-dark' : 'text-gray-500'}`}>已核准</button>
                <button onClick={() => setFilter(LeaveStatus.Rejected)} className={`py-2 px-4 font-semibold ${filter === LeaveStatus.Rejected ? 'border-b-2 border-brand-blue-dark text-brand-blue-dark' : 'text-gray-500'}`}>已駁回</button>
            </div>

            <div className="space-y-4">
                {loading ? <p>讀取中...</p> : filteredRequests.length > 0 ? (
                    filteredRequests.map(req => (
                        <div key={req.id} className="p-4 border rounded-lg shadow-sm bg-gray-50">
                            <div className="flex flex-wrap justify-between items-start">
                                <div>
                                    <p className="font-bold text-lg">{req.name} - <span className="font-medium text-brand-blue-dark">{req.leaveType}</span></p>
                                    <p className="text-sm text-gray-600">申請日期: {new Date(req.requestDate).toLocaleDateString()}</p>
                                    <p className="text-sm text-gray-600">期間: {new Date(req.startDate).toLocaleString()} to {new Date(req.endDate).toLocaleString()}</p>
                                    <p className="mt-2 text-gray-800 bg-white p-2 rounded border">{req.reason}</p>
                                </div>
                                <div className="text-right">
                                     <span className={`px-3 py-1 text-sm font-medium rounded-full ${getStatusChipClass(req.status)}`}>{req.status}</span>
                                     {req.status !== LeaveStatus.Pending && (
                                         <p className="text-xs text-gray-500 mt-2">由 {req.approver} 於 {req.approvalDate ? new Date(req.approvalDate).toLocaleDateString() : ''} 審核</p>
                                     )}
                                </div>
                            </div>
                           
                            {req.status === LeaveStatus.Pending && (
                                <div className="flex justify-end space-x-3 mt-4">
                                    <button onClick={() => handleApproval(req.id, LeaveStatus.Approved)} className="px-4 py-2 text-sm font-medium text-white bg-status-success rounded-lg hover:bg-green-700">核准</button>
                                    <button onClick={() => handleApproval(req.id, LeaveStatus.Rejected)} className="px-4 py-2 text-sm font-medium text-white bg-status-error rounded-lg hover:bg-red-700">駁回</button>
                                </div>
                            )}
                        </div>
                    ))
                ) : (
                    <p className="text-center text-gray-500 py-10">無相關請假申請</p>
                )}
            </div>
        </div>
    );
};

export default LeaveApprovalQueue;
