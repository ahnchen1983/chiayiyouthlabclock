import { describe, it, expect } from 'vitest';
import {
    maskName,
    maskEmpId,
    maskIP,
    maskGPS,
    maskVerificationData,
} from '../netlify/functions/utils/csvMasking';

describe('maskName', () => {
    it('3 字以上：首末字保留，中間以 ○ 代替', () => {
        expect(maskName('王小明')).toBe('王○明');
        expect(maskName('陳大文豪')).toBe('陳○○豪');
        expect(maskName('歐陽小明明')).toBe('歐○○○明');
    });

    it('2 字：首字保留，第 2 字遮為 ○', () => {
        expect(maskName('王明')).toBe('王○');
        expect(maskName('李四')).toBe('李○');
    });

    it('1 字 / 空字串原樣回傳', () => {
        expect(maskName('李')).toBe('李');
        expect(maskName('')).toBe('');
    });

    it('英文姓名照字元數遮罩', () => {
        expect(maskName('Anna')).toBe('A○○a');
    });
});

describe('maskEmpId', () => {
    it('5 碼以上：前 3 + 末 1 保留', () => {
        expect(maskEmpId('EMP001')).toBe('EMP**1');
        expect(maskEmpId('ADMIN')).toBe('ADM*N');
        expect(maskEmpId('EMP12345')).toBe('EMP****5');
    });

    it('4 碼：前 3 + 中間 1 個 *', () => {
        expect(maskEmpId('EMP1')).toBe('EMP*');
    });

    it('≤ 3 碼不遮（過短）', () => {
        expect(maskEmpId('EMP')).toBe('EMP');
        expect(maskEmpId('AB')).toBe('AB');
        expect(maskEmpId('X')).toBe('X');
        expect(maskEmpId('')).toBe('');
    });
});

describe('maskIP', () => {
    it('IPv4 遮後兩段', () => {
        expect(maskIP('192.168.1.100')).toBe('192.168.*.*');
        expect(maskIP('10.0.0.1')).toBe('10.0.*.*');
        expect(maskIP('203.74.205.12')).toBe('203.74.*.*');
    });

    it('非 IPv4 原樣回傳（unknown / IPv6 / 亂碼 / 空）', () => {
        expect(maskIP('unknown')).toBe('unknown');
        expect(maskIP('::1')).toBe('::1');
        expect(maskIP('abc.def')).toBe('abc.def');
        expect(maskIP('999.999.999.999')).toBe('999.999.999.999'); // 數字但超出 0–255 範圍
        expect(maskIP('')).toBe('');
    });
});

describe('maskGPS', () => {
    it('座標取小數點 2 位（無空白）', () => {
        expect(maskGPS('23.4801,120.4501')).toBe('23.48,120.45');
    });

    it('座標取小數點 2 位（含空白並保留）', () => {
        expect(maskGPS('23.4801, 120.4501')).toBe('23.48, 120.45');
    });

    it('支援負數座標', () => {
        expect(maskGPS('-23.4801,120.4501')).toBe('-23.48,120.45');
    });

    it('非座標格式原樣回傳', () => {
        expect(maskGPS('unknown')).toBe('unknown');
        expect(maskGPS('')).toBe('');
        expect(maskGPS('not, a, gps')).toBe('not, a, gps');
    });
});

describe('maskVerificationData', () => {
    it('IP method 切到 maskIP', () => {
        expect(maskVerificationData('IP', '192.168.1.100')).toBe('192.168.*.*');
    });

    it('GPS method 切到 maskGPS', () => {
        expect(maskVerificationData('GPS', '23.4801,120.4501')).toBe('23.48,120.45');
    });

    it('未知 method 原樣回傳', () => {
        expect(maskVerificationData('UNKNOWN', 'anything')).toBe('anything');
        expect(maskVerificationData('', 'anything')).toBe('anything');
    });
});
