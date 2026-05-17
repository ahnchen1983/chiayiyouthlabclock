import { describe, it, expect } from 'vitest';
import { buildAttendanceHtml } from '../services/attendancePrint';
import { ClockRecord } from '../types';

const mk = (over: Partial<ClockRecord>): ClockRecord => ({
    id: 'r1', empId: 'E001', name: '王小明', date: '2026-05-01',
    clockInTime: '09:00', clockOutTime: '18:00',
    verificationMethod: 'IP', verificationData: '192.168.1.1',
    workHours: 8, status: '正常',
    ...over,
});

describe('buildAttendanceHtml — 員工版', () => {
    it('標題含員工姓名與「的出勤紀錄」字樣', () => {
        const html = buildAttendanceHtml([mk({})], {
            empName: '王小明', month: '2026-05', isAdminView: false,
        });
        expect(html).toContain('王小明 的出勤紀錄');
        expect(html).toContain('2026-05');
    });

    it('統計列包含正確總工時與筆數', () => {
        const records = [
            mk({ workHours: 8, status: '正常' }),
            mk({ id: 'r2', workHours: 7.5, status: '遲到' }),
        ];
        const html = buildAttendanceHtml(records, {
            empName: '王小明', month: '2026-05', isAdminView: false,
        });
        expect(html).toContain('>15.5<');
        expect(html).toContain('>2<');
        expect(html).toContain('>1<');
    });

    it('明細表含每筆日期、上下班時間、狀態、備註', () => {
        const html = buildAttendanceHtml(
            [mk({ date: '2026-05-01', status: '遲到', note: '塞車' })],
            { empName: '王小明', month: '2026-05', isAdminView: false },
        );
        expect(html).toContain('2026-05-01');
        expect(html).toContain('09:00');
        expect(html).toContain('18:00');
        expect(html).toContain('遲到');
        expect(html).toContain('塞車');
    });
});

describe('buildAttendanceHtml — 管理員版', () => {
    it('標題為「全員出勤紀錄 - YYYY-MM」', () => {
        const html = buildAttendanceHtml([mk({})], { month: '2026-05', isAdminView: true });
        expect(html).toContain('全員出勤紀錄 - 2026-05');
    });

    it('多員工資料按員工分節', () => {
        const records = [
            mk({ empId: 'E001', name: '王小明' }),
            mk({ id: 'r2', empId: 'E002', name: '陳大文' }),
        ];
        const html = buildAttendanceHtml(records, { month: '2026-05', isAdminView: true });
        expect(html).toContain('王小明');
        expect(html).toContain('陳大文');
        expect(html).toContain('(E001)');
        expect(html).toContain('(E002)');
        const sectionCount = (html.match(/class="emp-section"/g) || []).length;
        expect(sectionCount).toBe(2);
    });

    it('空陣列顯示「無符合條件的紀錄」', () => {
        const html = buildAttendanceHtml([], { month: '2026-05', isAdminView: true });
        expect(html).toContain('無符合條件的紀錄');
    });
});

describe('buildAttendanceHtml — 頁尾與安全', () => {
    it('頁尾含「列印時間」與系統名稱', () => {
        const html = buildAttendanceHtml([], { empName: '王', month: '2026-05', isAdminView: false });
        expect(html).toContain('列印時間');
        expect(html).toContain('嘉義青年實驗室打卡系統');
    });

    it('員工姓名含 HTML 特殊字元時會被 escape', () => {
        const html = buildAttendanceHtml(
            [mk({ name: '<script>alert(1)</script>' })],
            { month: '2026-05', isAdminView: true },
        );
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('備註含特殊字元也 escape', () => {
        const html = buildAttendanceHtml(
            [mk({ note: '<bad>&"\'' })],
            { empName: '王', month: '2026-05', isAdminView: false },
        );
        expect(html).not.toContain('<bad>');
        expect(html).toContain('&lt;bad&gt;');
    });
});
