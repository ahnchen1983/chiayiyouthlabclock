import {attendanceCaseMonthWindow} from './attendanceWindow';
import {scheduleDayVersion} from './attendanceCaseDetector';
import {shiftIntervals,validDate} from '../../../utils/attendance';
import type {DetectorInput} from './attendanceCaseTypes';
export interface AttendancePolicyDeclaration {
 schemaVersion:'attendance-policy-declaration-v1';version:string;status:'approved';empId:string;month:string;approvedBy:string;approvedAt:string;
 workDateRule:'clock-in-date';breaks:'explicit';closeAfterMinutes:number;lateGraceMinutes:number;earlyGraceMinutes:number;workDifferenceTolerance:number;
 expectedWorkByDate:NonNullable<NonNullable<DetectorInput['policy']>['expectedWorkByDate']>;
}
const text=(v:any):v is string=>typeof v==='string'&&!!v.trim();
const minutes=(v:any)=>Number.isInteger(v)&&v>=0;
export function assessAttendancePolicyEvidence(args:{empId:string;month:string;declaration:unknown;schedules:unknown}):{status:'verified'|'unknown';policy:DetectorInput['policy'];missingInputs:string[]}{
 const missing=new Set<string>(),d=args.declaration as any;let window:{start:number;end:number};
 try{window=attendanceCaseMonthWindow(args.month);}catch{return {status:'unknown',policy:null,missingInputs:['policy.scope']};}
 if(!text(args.empId)||!d||d.schemaVersion!=='attendance-policy-declaration-v1'||d.empId!==args.empId||d.month!==args.month)missing.add('policy.scope');
 if(!d||d.status!=='approved'||!text(d.version)||!text(d.approvedBy)||d.approvedBy===args.empId||!text(d.approvedAt)||!Number.isFinite(Date.parse(d.approvedAt)))missing.add('policy.approval');
 for(const key of ['closeAfterMinutes','lateGraceMinutes','earlyGraceMinutes','workDifferenceTolerance'] as const)if(!minutes(d?.[key]))missing.add('policy.'+key);
 if(d?.workDateRule!=='clock-in-date')missing.add('policy.workDateRule');if(d?.breaks!=='explicit')missing.add('policy.breaks');
 if(!d?.expectedWorkByDate||typeof d.expectedWorkByDate!=='object'||Array.isArray(d.expectedWorkByDate))missing.add('policy.expectedWorkByDate');
 const targets:NonNullable<NonNullable<DetectorInput['policy']>['expectedWorkByDate']>={};
 if(!Array.isArray(args.schedules))missing.add('coverage.schedules');
 else{
  const dates=new Set<string>();
  for(const day of args.schedules){
   if(!day||!validDate(day.date)||!Array.isArray(day.shifts)||day.shifts.some((s:any)=>!s||!text(s.empId))){missing.add('coverage.schedules');continue;}
   const shifts=day.shifts.filter((s:any)=>s.empId===args.empId);if(!shifts.length)continue;
   const spans=shiftIntervals(shifts),base=Date.parse(day.date+'T00:00:00+08:00')/60000;
   if(!spans){missing.add('coverage.schedules');continue;}
   if(!spans.some(s=>base+s.start<window.end&&base+s.end>window.start))continue;
   if(dates.has(day.date))missing.add('coverage.schedules');dates.add(day.date);
   const target=d?.expectedWorkByDate?.[day.date];
   if(!target||!minutes(target.minutes)||!text(target.reviewedBy)||target.reviewedBy===args.empId||target.scheduleVersion!==scheduleDayVersion(day,args.empId))missing.add('policy.expectedWorkByDate:'+day.date);
   else targets[day.date]={minutes:target.minutes,scheduleVersion:target.scheduleVersion,reviewedBy:target.reviewedBy};
  }
 }
 if(missing.size)return {status:'unknown',policy:null,missingInputs:[...missing].sort()};
 return {status:'verified',missingInputs:[],policy:{version:d.version,reviewedBy:d.approvedBy,reviewedAt:d.approvedAt,workDateRule:'clock-in-date',breaks:'explicit',
  closeAfterMinutes:d.closeAfterMinutes,lateGraceMinutes:d.lateGraceMinutes,earlyGraceMinutes:d.earlyGraceMinutes,workDifferenceTolerance:d.workDifferenceTolerance,expectedWorkByDate:targets}};
}
