export const attendanceCaseMonthWindow=(month:string)=>{
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))(()=>{throw Object.assign(new Error('月份無效'),{statusCode:400});})();
 const start=Date.parse(month+'-01T00:00:00+08:00')/60000;
 const next=new Date(month+'-01T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);
 return {start,end:Date.parse(next.toISOString().slice(0,10)+'T00:00:00+08:00')/60000};
};
