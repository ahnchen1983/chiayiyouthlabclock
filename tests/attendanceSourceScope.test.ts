import {describe,it,expect} from 'vitest';
import {loadAttendanceClockRecords} from '../netlify/functions/utils/attendanceCaseEvidence';
import {card} from './fixtures/payrollV2';
const load=(records:any[])=>{
 const calls:any[]=[];const query:any={where:(...args:any[])=>{calls.push(args);return query;},limit:(limit:number)=>{calls.push(limit);return {limit};}};
 const db={collection:(name:string)=>{calls.push(name);return query;}};
 const tx={get:async(ref:any)=>{const docs=records.slice(0,ref.limit).map((r,i)=>({id:'R'+i,data:()=>r}));return {size:docs.length,docs};}};
 return {calls,result:loadAttendanceClockRecords(db,tx,'SYNTH','2026-04')};
};
describe('bounded attendance clock source scope',()=>{
 it('drops proven unrelated history before enforcing relevant capacity',async()=>{
  const history=Array.from({length:2000},()=>card('2020-01-01'));
  const {result,calls}=load([...history,card('2026-04-01')]);expect(await result).toHaveLength(1);expect(calls).toContain(10001);
 });
 it('retains six-day context and whole prior-day overnight tail without clipping',async()=>{
  const tail={...card('2026-03-25','22:00','06:00',false),clockInAt:'2026-03-25T22:00:00+08:00',clockOutAt:'2026-03-26T06:00:00+08:00'};
  const input=[tail,card('2026-03-26'),card('2026-05-06'),card('2026-05-07')];
  const got=await load(input).result;expect(got.map(r=>r.date)).toEqual(['2026-03-25','2026-03-26','2026-05-06']);expect(got[0].clockOutAt).toBe(tail.clockOutAt);
 });
 it.each([
  {...card('2020-01-01'),date:undefined},
  {...card('2020-01-01'),date:'2020-02-30'},
  {...card('2020-01-01'),clockOutTime:null},
  {...card('2020-01-01'),clockInAt:'garbage'},
  {...card('2020-01-01'),clockInAt:'2026-04-01T09:00:00+08:00',clockOutAt:'2026-04-01T17:00:00+08:00'},
  {...card('2020-01-01'),workIntervals:[{start:540,end:99999999}]},
 ])('does not discard ambiguous or malformed raw source: %#',async r=>{expect(await load([r]).result).toHaveLength(1);});
 it('fails closed above relevant or full inventory capacity without partial output',async()=>{
  await expect(load(Array.from({length:501},()=>card('2026-04-01'))).result).rejects.toMatchObject({statusCode:409});
  await expect(load(Array.from({length:10001},()=>card('2020-01-01'))).result).rejects.toMatchObject({statusCode:409});
 });
});
