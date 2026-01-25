import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Shift, AttendanceRecord, UserRole, EmployeeType } from '../types';
import { MOCK_USERS } from '../constants';

interface StoreContextType {
    users: User[];
    shifts: Shift[];
    attendance: AttendanceRecord[];

    // Actions
    addUser: (user: User) => void;
    updateUser: (user: User) => void;
    deleteUser: (id: string) => void;

    addShift: (shift: Shift) => void;
    updateShift: (shift: Shift) => void;
    deleteShift: (id: string) => void;
    setShifts: (shifts: Shift[]) => void; // For bulk updates or AI generation

    clockIn: (record: AttendanceRecord) => void;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Initialize state from localStorage or defaults
    const [users, setUsers] = useState<User[]>(() => {
        const saved = localStorage.getItem('users');
        return saved ? JSON.parse(saved) : MOCK_USERS;
    });

    const [shifts, setShiftsState] = useState<Shift[]>(() => {
        const saved = localStorage.getItem('shifts');
        return saved ? JSON.parse(saved) : [];
    });

    const [attendance, setAttendance] = useState<AttendanceRecord[]>(() => {
        const saved = localStorage.getItem('attendance');
        return saved ? JSON.parse(saved) : [];
    });

    // Persistence Effects
    useEffect(() => {
        localStorage.setItem('users', JSON.stringify(users));
    }, [users]);

    useEffect(() => {
        localStorage.setItem('shifts', JSON.stringify(shifts));
    }, [shifts]);

    useEffect(() => {
        localStorage.setItem('attendance', JSON.stringify(attendance));
    }, [attendance]);

    // Actions
    const addUser = (user: User) => {
        setUsers(prev => [...prev, user]);
    };

    const updateUser = (updatedUser: User) => {
        setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
    };

    const deleteUser = (id: string) => {
        setUsers(prev => prev.filter(u => u.id !== id));
        // Optional: Cleanup shifts associated with deleted user? 
        // For now, keep them or let admin clean up.
        setShiftsState(prev => prev.filter(s => s.userId !== id));
    };

    const addShift = (shift: Shift) => {
        setShiftsState(prev => [...prev, shift]);
    };

    const updateShift = (updatedShift: Shift) => {
        setShiftsState(prev => prev.map(s => s.id === updatedShift.id ? updatedShift : s));
    };

    const deleteShift = (id: string) => {
        setShiftsState(prev => prev.filter(s => s.id !== id));
    };

    const setShifts = (newShifts: Shift[]) => {
        setShiftsState(newShifts);
    };

    const clockIn = (record: AttendanceRecord) => {
        setAttendance(prev => [...prev, record]);
    };

    return (
        <StoreContext.Provider value={{
            users,
            shifts,
            attendance,
            addUser,
            updateUser,
            deleteUser,
            addShift,
            updateShift,
            deleteShift,
            setShifts,
            clockIn
        }}>
            {children}
        </StoreContext.Provider>
    );
};

export const useStore = () => {
    const context = useContext(StoreContext);
    if (!context) {
        throw new Error('useStore must be used within a StoreProvider');
    }
    return context;
};
