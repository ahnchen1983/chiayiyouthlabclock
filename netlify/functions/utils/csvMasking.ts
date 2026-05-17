/**
 * CSV 個資脫敏 — 純函數，無 I/O，可被 Vitest 與前端共用
 * Phase 7.7 (SDD A5)
 *
 * 設計原則：
 * 1. 純函數：相同輸入 → 相同輸出，無副作用
 * 2. 非破壞性 fallback：無效格式（空字串、非預期格式）原樣回傳
 * 3. 保留足夠識別性供管理員人工辨認，但去除可直接還原的部分
 */

/**
 * 姓名脫敏：保留首末字，中間以 ○ 代替
 *   "王小明"     → "王○明"
 *   "陳大文豪"   → "陳○○豪"
 *   "王明"       → "王○"   （2 字遮第 2 字）
 *   "李"         → "李"     （1 字保留）
 *   ""           → ""
 *   "Anna Wang"  → "A○○○○○○○g"   （空格也視為 1 個字符，被 ○ 取代）
 */
export const maskName = (name: string): string => {
    if (!name) return '';
    if (name.length === 1) return name;
    if (name.length === 2) return `${name[0]}○`;
    const first = name[0];
    const last = name[name.length - 1];
    const middle = '○'.repeat(name.length - 2);
    return `${first}${middle}${last}`;
};

/**
 * 員工編號脫敏：保留前 3 + 末 1，中間以 * 代替
 *   "EMP001"   → "EMP**1"
 *   "ADMIN"    → "ADM*N"
 *   "EMP1"     → "EMP*"     （4 碼 → 前 3 + 中間 1 個 *，無末碼）
 *   "EMP"      → "EMP"      （≤ 3 碼不遮）
 *   "AB"       → "AB"
 *   ""         → ""
 */
export const maskEmpId = (empId: string): string => {
    if (!empId) return '';
    if (empId.length <= 3) return empId;
    if (empId.length === 4) return `${empId.slice(0, 3)}*`;
    const prefix = empId.slice(0, 3);
    const suffix = empId.slice(-1);
    const mask = '*'.repeat(empId.length - 4);
    return `${prefix}${mask}${suffix}`;
};

/**
 * IP 位址脫敏：保留前兩段，後兩段以 * 代替
 *   "192.168.1.100"   → "192.168.*.*"
 *   "10.0.0.1"        → "10.0.*.*"
 *   "203.74.205.12"   → "203.74.*.*"
 *   "unknown"         → "unknown"
 *   "::1"             → "::1"  （IPv6 原樣）
 *   "abc.def"         → "abc.def"
 *   ""                → ""
 */
export const maskIP = (ip: string): string => {
    if (!ip) return '';
    const parts = ip.split('.');
    if (parts.length !== 4) return ip;
    // 每段須為 0–255 的整數
    if (!parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255)) return ip;
    return `${parts[0]}.${parts[1]}.*.*`;
};

/**
 * GPS 座標脫敏：取小數點後 2 位（約 1.1 公里精度）
 *   "23.4801,120.4501"   → "23.48,120.45"
 *   "23.4801, 120.4501"  → "23.48, 120.45"   （容忍空白並保留）
 *   "-23.4801,120.4501"  → "-23.48,120.45"   （負數可接受）
 *   "unknown"            → "unknown"
 *   ""                   → ""
 */
export const maskGPS = (gps: string): string => {
    if (!gps) return '';
    const m = gps.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
    if (!m) return gps;
    const lat = Number(m[1]).toFixed(2);
    const lng = Number(m[2]).toFixed(2);
    // 維持原 separator（有無空白）
    const hadSpace = /,\s/.test(gps);
    return `${lat}${hadSpace ? ', ' : ','}${lng}`;
};

/**
 * 通用 verificationData 脫敏 — 依 method 切到正確的 masker。
 * 未知 method 一律原樣回傳。
 */
export const maskVerificationData = (method: string, data: string): string => {
    if (method === 'IP') return maskIP(data);
    if (method === 'GPS') return maskGPS(data);
    return data;
};
