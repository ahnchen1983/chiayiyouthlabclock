
import React, { useState, useEffect } from 'react';
import {
    apiGetAllEmployeesDetail,
    apiCreateEmployee,
    apiUpdateEmployee,
    apiDeleteEmployee
} from '../../services/googleAppsScriptAPI';
import { Employee, EmployeeStatus, UserRole } from '../../types';
import { UsersIcon } from '../icons';

// 新增/編輯 icon
const PlusIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
);

const PencilIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
);

const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
);

// 狀態標籤
const StatusBadge: React.FC<{ status: EmployeeStatus }> = ({ status }) => {
    const colorMap: Record<EmployeeStatus, string> = {
        '在職': 'bg-green-100 text-green-800',
        '離職': 'bg-gray-100 text-gray-800',
        '留停': 'bg-yellow-100 text-yellow-800',
    };
    return (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${colorMap[status]}`}>
            {status}
        </span>
    );
};

// 職位標籤
const PositionBadge: React.FC<{ position: '專責人員' | '兼職人員' }> = ({ position }) => {
    const color = position === '專責人員' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700';
    return (
        <span className={`px-2 py-1 rounded text-xs font-medium ${color}`}>
            {position}
        </span>
    );
};

// 員工表單 Modal
interface EmployeeFormModalProps {
    employee: Employee | null;
    onClose: () => void;
    onSave: (data: Omit<Employee, 'id'> | Employee) => void;
    isNew: boolean;
}

const EmployeeFormModal: React.FC<EmployeeFormModalProps> = ({ employee, onClose, onSave, isNew }) => {
    const [formData, setFormData] = useState<Omit<Employee, 'id'>>({
        name: employee?.name || '',
        phone: employee?.phone || '',
        email: employee?.email || '',
        hourlyRate: employee?.hourlyRate || 183,
        hireDate: employee?.hireDate || new Date().toISOString().slice(0, 10),
        resignDate: employee?.resignDate || undefined,
        status: employee?.status || '在職',
        position: employee?.position || '兼職人員',
        role: employee?.role || UserRole.Employee,
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: name === 'hourlyRate' ? Number(value) : value
        }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (isNew) {
            onSave(formData);
        } else {
            onSave({ ...formData, id: employee!.id });
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between p-4 border-b">
                    <h3 className="text-lg font-bold text-gray-800">
                        {isNew ? '新增員工' : '編輯員工'}
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
                        <XIcon className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    {/* 姓名 */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            姓名 <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            required
                            className="w-full p-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    {/* 電話 */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            電話 <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="tel"
                            name="phone"
                            value={formData.phone}
                            onChange={handleChange}
                            required
                            placeholder="0912-345-678"
                            className="w-full p-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    {/* Email */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Email <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="email"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            required
                            className="w-full p-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    {/* 職位 & 角色 */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                職位 <span className="text-red-500">*</span>
                            </label>
                            <select
                                name="position"
                                value={formData.position}
                                onChange={(e) => {
                                    handleChange(e);
                                    // 專責人員自動設為管理者
                                    if (e.target.value === '專責人員') {
                                        setFormData(prev => ({ ...prev, role: UserRole.Admin, hourlyRate: 0 }));
                                    } else {
                                        setFormData(prev => ({ ...prev, role: UserRole.Employee }));
                                    }
                                }}
                                className="w-full p-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                <option value="專責人員">專責人員</option>
                                <option value="兼職人員">兼職人員</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                系統角色
                            </label>
                            <select
                                name="role"
                                value={formData.role}
                                onChange={handleChange}
                                className="w-full p-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                <option value={UserRole.Admin}>管理者</option>
                                <option value={UserRole.Employee}>員工</option>
                            </select>
                        </div>
                    </div>

                    {/* 時薪（僅兼職人員） */}
                    {formData.position === '兼職人員' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                時薪 (NTD)
                            </label>
                            <input
                                type="number"
                                name="hourlyRate"
                                value={formData.hourlyRate}
                                onChange={handleChange}
                                min="0"
                                className="w-full p-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                    )}

                    {/* 到職日 & 離職日 */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                到職日 <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="date"
                                name="hireDate"
                                value={formData.hireDate}
                                onChange={handleChange}
                                required
                                className="w-full p-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                離職日
                            </label>
                            <input
                                type="date"
                                name="resignDate"
                                value={formData.resignDate || ''}
                                onChange={handleChange}
                                className="w-full p-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                    </div>

                    {/* 狀態 */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            狀態
                        </label>
                        <select
                            name="status"
                            value={formData.status}
                            onChange={handleChange}
                            className="w-full p-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="在職">在職</option>
                            <option value="離職">離職</option>
                            <option value="留停">留停</option>
                        </select>
                    </div>

                    {/* 按鈕 */}
                    <div className="flex justify-end gap-3 pt-4 border-t">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200"
                        >
                            取消
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 text-white bg-blue-500 rounded-md hover:bg-blue-600"
                        >
                            {isNew ? '新增' : '儲存'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// 刪除確認 Modal
interface DeleteConfirmModalProps {
    employee: Employee;
    onClose: () => void;
    onConfirm: () => void;
}

const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({ employee, onClose, onConfirm }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-2">確認刪除</h3>
            <p className="text-gray-600 mb-4">
                確定要刪除員工「<span className="font-semibold">{employee.name}</span>」嗎？此操作無法復原。
            </p>
            <div className="flex justify-end gap-3">
                <button
                    onClick={onClose}
                    className="px-4 py-2 text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                    取消
                </button>
                <button
                    onClick={onConfirm}
                    className="px-4 py-2 text-white bg-red-500 rounded-md hover:bg-red-600"
                >
                    確認刪除
                </button>
            </div>
        </div>
    </div>
);

const EmployeeManager: React.FC = () => {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [showFormModal, setShowFormModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
    const [isNew, setIsNew] = useState(false);
    const [filterStatus, setFilterStatus] = useState<EmployeeStatus | 'all'>('all');
    const [filterPosition, setFilterPosition] = useState<'專責人員' | '兼職人員' | 'all'>('all');
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        fetchEmployees();
    }, []);

    const fetchEmployees = async () => {
        setLoading(true);
        const data = await apiGetAllEmployeesDetail();
        setEmployees(data);
        setLoading(false);
    };

    const handleAdd = () => {
        setSelectedEmployee(null);
        setIsNew(true);
        setShowFormModal(true);
    };

    const handleEdit = (emp: Employee) => {
        setSelectedEmployee(emp);
        setIsNew(false);
        setShowFormModal(true);
    };

    const handleDelete = (emp: Employee) => {
        setSelectedEmployee(emp);
        setShowDeleteModal(true);
    };

    const handleSave = async (data: Omit<Employee, 'id'> | Employee) => {
        if (isNew) {
            await apiCreateEmployee(data as Omit<Employee, 'id'>);
        } else {
            await apiUpdateEmployee((data as Employee).id, data);
        }
        setShowFormModal(false);
        fetchEmployees();
    };

    const handleConfirmDelete = async () => {
        if (selectedEmployee) {
            await apiDeleteEmployee(selectedEmployee.id);
            setShowDeleteModal(false);
            setSelectedEmployee(null);
            fetchEmployees();
        }
    };

    // 篩選邏輯
    const filteredEmployees = employees.filter(emp => {
        const matchStatus = filterStatus === 'all' || emp.status === filterStatus;
        const matchPosition = filterPosition === 'all' || emp.position === filterPosition;
        const matchSearch = emp.name.includes(searchTerm) ||
            emp.email.includes(searchTerm) ||
            emp.phone.includes(searchTerm);
        return matchStatus && matchPosition && matchSearch;
    });

    return (
        <div className="p-4 bg-white rounded-lg shadow-lg">
            {/* 標題和新增按鈕 */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                    <UsersIcon className="w-7 h-7 text-blue-500" />
                    員工管理
                </h1>
                <button
                    onClick={handleAdd}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                >
                    <PlusIcon className="w-5 h-5" />
                    新增員工
                </button>
            </div>

            {/* 篩選區 */}
            <div className="flex flex-wrap items-center gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
                <div>
                    <label className="mr-2 text-sm font-medium text-gray-700">搜尋:</label>
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="姓名、電話、Email"
                        className="p-2 border rounded-md w-48"
                    />
                </div>
                <div>
                    <label className="mr-2 text-sm font-medium text-gray-700">職位:</label>
                    <select
                        value={filterPosition}
                        onChange={(e) => setFilterPosition(e.target.value as typeof filterPosition)}
                        className="p-2 border rounded-md"
                    >
                        <option value="all">全部</option>
                        <option value="專責人員">專責人員</option>
                        <option value="兼職人員">兼職人員</option>
                    </select>
                </div>
                <div>
                    <label className="mr-2 text-sm font-medium text-gray-700">狀態:</label>
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
                        className="p-2 border rounded-md"
                    >
                        <option value="all">全部</option>
                        <option value="在職">在職</option>
                        <option value="離職">離職</option>
                        <option value="留停">留停</option>
                    </select>
                </div>
            </div>

            {/* 員工列表 */}
            <div className="overflow-x-auto">
                <table className="min-w-full bg-white">
                    <thead className="bg-gray-100">
                        <tr>
                            <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-600">員工編號</th>
                            <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-600">姓名</th>
                            <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-600">職位</th>
                            <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-600">電話</th>
                            <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-600">Email</th>
                            <th className="py-3 px-4 border-b text-center text-sm font-semibold text-gray-600">時薪</th>
                            <th className="py-3 px-4 border-b text-center text-sm font-semibold text-gray-600">到職日</th>
                            <th className="py-3 px-4 border-b text-center text-sm font-semibold text-gray-600">狀態</th>
                            <th className="py-3 px-4 border-b text-center text-sm font-semibold text-gray-600">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={9} className="text-center py-10">
                                    <div className="flex justify-center">
                                        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                                    </div>
                                </td>
                            </tr>
                        ) : filteredEmployees.length > 0 ? (
                            filteredEmployees.map(emp => (
                                <tr key={emp.id} className="hover:bg-gray-50">
                                    <td className="py-3 px-4 border-b text-sm text-gray-500">{emp.id}</td>
                                    <td className="py-3 px-4 border-b text-sm font-medium text-gray-800">{emp.name}</td>
                                    <td className="py-3 px-4 border-b">
                                        <PositionBadge position={emp.position} />
                                    </td>
                                    <td className="py-3 px-4 border-b text-sm text-gray-600">{emp.phone}</td>
                                    <td className="py-3 px-4 border-b text-sm text-gray-600">{emp.email}</td>
                                    <td className="py-3 px-4 border-b text-sm text-center text-gray-600">
                                        {emp.position === '兼職人員' ? `$${emp.hourlyRate}` : '-'}
                                    </td>
                                    <td className="py-3 px-4 border-b text-sm text-center text-gray-600">{emp.hireDate}</td>
                                    <td className="py-3 px-4 border-b text-center">
                                        <StatusBadge status={emp.status} />
                                    </td>
                                    <td className="py-3 px-4 border-b text-center">
                                        <div className="flex justify-center gap-2">
                                            <button
                                                onClick={() => handleEdit(emp)}
                                                className="p-2 text-blue-500 hover:bg-blue-50 rounded-md transition-colors"
                                                title="編輯"
                                            >
                                                <PencilIcon className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(emp)}
                                                className="p-2 text-red-500 hover:bg-red-50 rounded-md transition-colors"
                                                title="刪除"
                                            >
                                                <TrashIcon className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={9} className="text-center py-10 text-gray-500">
                                    沒有符合條件的員工
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* 統計資訊 */}
            <div className="mt-4 text-sm text-gray-500">
                共 {filteredEmployees.length} 位員工
                {filterStatus !== 'all' || filterPosition !== 'all' || searchTerm
                    ? ` (全部 ${employees.length} 位)`
                    : ''}
            </div>

            {/* Modals */}
            {showFormModal && (
                <EmployeeFormModal
                    employee={selectedEmployee}
                    onClose={() => setShowFormModal(false)}
                    onSave={handleSave}
                    isNew={isNew}
                />
            )}

            {showDeleteModal && selectedEmployee && (
                <DeleteConfirmModal
                    employee={selectedEmployee}
                    onClose={() => setShowDeleteModal(false)}
                    onConfirm={handleConfirmDelete}
                />
            )}
        </div>
    );
};

export default EmployeeManager;
