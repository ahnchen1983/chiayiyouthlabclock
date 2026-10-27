import { useEffect, useState } from 'react';
import {
  apiGetAllLeaveRequests,
  apiGetEmployeeLeaveRequests,
  apiGetEmployeeMakeupRequests,
  apiGetLeaveOfAbsenceRequests,
  apiGetMakeupRequests,
  apiGetMyLeaveOfAbsenceRequests,
  apiListShiftSwapRequests,
} from '../../services/googleAppsScriptAPI';

const OPEN_REQUEST = new Set(['待審核', '待補件']);

export type PendingNavCounts = Partial<Record<string, number>>;

function countStatus(rows: { status?: string }[] | undefined, allowed: Set<string>): number | undefined {
  if (!rows) return undefined;
  return rows.reduce((sum, row) => sum + (row.status && allowed.has(row.status) ? 1 : 0), 0);
}

async function read<T>(task: Promise<T>): Promise<T | undefined> {
  try {
    return await task;
  } catch {
    return undefined;
  }
}

export function usePendingNavCounts(kind: 'admin' | 'employee', empId?: string): PendingNavCounts {
  const [counts, setCounts] = useState<PendingNavCounts>({});

  useEffect(() => {
    let cancelled = false;
    const apply = (next: PendingNavCounts) => {
      if (!cancelled) setCounts(next);
    };

    if (kind === 'admin') {
      void (async () => {
        const [leaves, makeups, swaps, loas] = await Promise.all([
          read(apiGetAllLeaveRequests()),
          read(apiGetMakeupRequests()),
          read(apiListShiftSwapRequests('admin-pending')),
          read(apiGetLeaveOfAbsenceRequests()),
        ]);
        const next: PendingNavCounts = {};
        const leave = countStatus(leaves, OPEN_REQUEST);
        const makeup = countStatus(makeups, OPEN_REQUEST);
        const swap = swaps ? swaps.filter((row) => row.status === 'awaiting-admin').length : undefined;
        const loa = countStatus(loas, new Set(['待審核']));
        if (leave) next.leave = leave;
        if (makeup) next.makeupApproval = makeup;
        if (swap) next.shiftSwapApproval = swap;
        if (loa) next.loaApproval = loa;
        apply(next);
      })();
    } else if (empId) {
      void (async () => {
        const [leaves, makeups, swaps, loas] = await Promise.all([
          read(apiGetEmployeeLeaveRequests(empId)),
          read(apiGetEmployeeMakeupRequests()),
          read(apiListShiftSwapRequests('mine')),
          read(apiGetMyLeaveOfAbsenceRequests()),
        ]);
        const next: PendingNavCounts = {};
        const leave = countStatus(leaves, OPEN_REQUEST);
        const makeup = countStatus(makeups, OPEN_REQUEST);
        const swap = swaps
          ? swaps.filter((row) => row.status === 'awaiting-peer' && row.toEmpId === empId).length
          : undefined;
        const loa = countStatus(loas, new Set(['待審核']));
        if (leave) next.leave = leave;
        if (makeup) next.makeup = makeup;
        if (swap) next.shiftSwap = swap;
        if (loa) next.leaveOfAbsence = loa;
        apply(next);
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [kind, empId]);

  return counts;
}
