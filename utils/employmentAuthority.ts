import {validDate,taipeiDate} from './attendance';
export type EmploymentState='active'|'loa'|'not-employed'|'unknown';
export function employmentStateOn(employee:any,date:string):EmploymentState{
 if(!validDate(date))return 'unknown';const a=employee.employmentAuthority;
 if(a){if(a.kind!=='effective-master'||!a.version||!validDate(a.from)||!validDate(a.to)||date<a.from||date>a.to)return 'unknown';if(a.accountKind==='system-account')return 'not-employed';const rows=a.periods?.filter((p:any)=>validDate(p.from)&&validDate(p.to)&&p.from<=date&&p.to>=date);return rows?.length===1&&['active','loa','not-employed'].includes(rows[0].employmentState)?rows[0].employmentState:'unknown';}
 if(employee.accountKind==='system-account')return 'not-employed';if(!validDate(employee.hireDate)||employee.resignDate&&(!validDate(employee.resignDate)||employee.resignDate<employee.hireDate)||employee.status==='離職'&&!employee.resignDate)return 'unknown';
 if(date<employee.hireDate||employee.resignDate&&date>employee.resignDate)return 'not-employed';if(employee.leaveOfAbsenceStart){if(!validDate(employee.leaveOfAbsenceStart)||employee.leaveOfAbsenceEnd&&(!validDate(employee.leaveOfAbsenceEnd)||employee.leaveOfAbsenceEnd<employee.leaveOfAbsenceStart))return 'unknown';if(date>=employee.leaveOfAbsenceStart&&(!employee.leaveOfAbsenceEnd||date<=employee.leaveOfAbsenceEnd))return 'loa';}return 'active';
}
export function employmentWindowStates(employee:any,start:number,end:number):EmploymentState[]{
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>366*1440)return ['unknown'];const states:EmploymentState[]=[];const last=taipeiDate(new Date((end-1)*60000));for(let d=taipeiDate(new Date(start*60000));d<=last;d=new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10))states.push(employmentStateOn(employee,d));return states;
}
