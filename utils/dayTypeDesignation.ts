import {validDate} from './attendance';
/** Personal monthly designation of 例假／休息日 (company confirmed 2026-10-25:
 * each person designates them in 偏好設定; not a fixed weekday). Pure shared rules.
 * LSA Art.36: every seven days at least one regular holiday and one rest day.
 * https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=36 (checked 2026-10-25)
 * The approved week boundary is not known yet, so rolling windows only warn.
 */
export type DesignatedDayType='normal'|'rest'|'regular-holiday'|'national-holiday';
export const validMonth=(m:unknown):m is string=>typeof m==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(m);
export const monthDates=(m:string)=>{const n=new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5)),0)).getUTCDate();return Array.from({length:n},(_,i)=>m+'-'+String(i+1).padStart(2,'0'));};
/** Returns sorted unique dates or an error message; never coerces invalid input. */
export function parseMonthDates(value:unknown,month:string,label:string):string[]|string{
 if(!Array.isArray(value)||value.length>31)return label+'格式無效';
 if(value.some(d=>typeof d!=='string'||!validDate(d)||!d.startsWith(month+'-')))return label+'含無效或非本月日期';
 if(new Set(value).size!==value.length)return label+'日期重複';
 return [...value].sort();
}
export function designationWarnings(month:string,regular:string[],rest:string[]):string[]{
 const days=monthDates(month),off=new Set([...regular,...rest]),warnings:string[]=[];
 if(!regular.length)warnings.push('本月未指定任何例假');
 if(!rest.length)warnings.push('本月未指定任何休息日');
 let run=0,max=0;for(const d of days){run=off.has(d)?0:run+1;max=Math.max(max,run);}
 if(max>6)warnings.push('月內連續 '+max+' 日未指定例假或休息日（每7日應有1例假1休息日），請核對週期');
 const windows=(set:Set<string>)=>days.slice(0,days.length-6).some((_,i)=>days.slice(i,i+7).every(d=>!set.has(d)));
 if(regular.length&&windows(new Set(regular)))warnings.push('月內有連續7日沒有例假，請核對週期');
 if(rest.length&&windows(new Set(rest)))warnings.push('月內有連續7日沒有休息日，請核對週期');
 return warnings;
}
/** Every date in the month gets exactly one type; only an explicit reviewer
 * confirmation turns undesignated dates into normal workdays. */
export function designationDays(month:string,regular:string[],rest:string[],national:string[]):Record<string,DesignatedDayType>{
 const r=new Set(regular),s=new Set(rest),n=new Set(national);
 return Object.fromEntries(monthDates(month).map(d=>[d,r.has(d)?'regular-holiday':s.has(d)?'rest':n.has(d)?'national-holiday':'normal']));
}
