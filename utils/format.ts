export const formatMoney = (value: number | null | undefined): string => value == null || !Number.isFinite(value) ? '待覆核' : new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
export const roundMoney = (value: number, decimals: 0 | 2 = 2): number => Math.round((value + Number.EPSILON) * 10 ** decimals) / 10 ** decimals;
export const formatHours = (value: number | null | undefined): string => value == null || !Number.isFinite(value) ? '待覆核' : Number(value.toFixed(4)).toString();
