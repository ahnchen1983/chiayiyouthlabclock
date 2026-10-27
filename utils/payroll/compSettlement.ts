import {mul,rational,sum,evidence,type FractionEvidence,type Rational} from './rational';
/** Pays out untaken comp time (LSA Art.32-1 para 2; Enforcement Rules Art.22-2).
 * Comp time is taken in the order the work happened, so a lot's used minutes are
 * its earliest ones and the untaken minutes are its last ones; each is paid at the
 * hourly basis and multiplier that minute had on the original day. Expiry is paid
 * in the deadline's payroll month (the payday falls within 30 days after it); exit
 * settles unexpired lots in the exit month (Art.9). Older expired lots need their
 * prior settlement reconciled: this input has no payment/settlement evidence.
 * A lot whose deadline falls after exit is not included again in a later expiry
 * candidate; this calculation alone is never proof that an amount was paid.
 * https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030002&flno=22-2 (checked 2026-10-25)
 */
export interface CompLot {id:string;start:number;end:number;deadline:string;untakenMinutes:number;originalWageBasis:any}
export interface CompSettlementItem {lotId:string;reason:'expired'|'contract-ended';minutes:number;exact:FractionEvidence;parts:Array<{start:number;end:number;minutes:number;hourlyBasis:FractionEvidence;multiplier:FractionEvidence}>}
export interface CompSettlement {items:CompSettlementItem[];exact:FractionEvidence;issues:string[]}
const f=(x:FractionEvidence):Rational=>rational(BigInt(x.numerator),BigInt(x.denominator));
const positiveFraction=(x:any):x is FractionEvidence=>typeof x?.numerator==='string'&&typeof x?.denominator==='string'&&/^\d+$/.test(x.numerator)&&/^\d+$/.test(x.denominator)&&BigInt(x.numerator)>0n&&BigInt(x.denominator)>0n;
export function settleCompLots(lots:CompLot[],range:{first:string;last:string},employment:{exitInMonth:boolean;activeOn:(date:string)=>boolean}):CompSettlement{
 const items:CompSettlementItem[]=[],values:Rational[]=[],issues:string[]=[];
 for(const lot of lots){
  if(employment.exitInMonth&&lot.deadline<range.first&&lot.untakenMinutes>0){issues.push('補休已於先前月份到期，需核對結清紀錄，不可於離職月重複計入 '+lot.id);continue;}
  const due=employment.exitInMonth?'contract-ended':lot.deadline>=range.first&&lot.deadline<=range.last&&employment.activeOn(lot.deadline)?'expired':null;
  if(!due)continue;
  const b=lot.originalWageBasis,tiers=Array.isArray(b?.tiers)?b.tiers:null;
  if(b?.status!=='confirmed'||!tiers||!Number.isSafeInteger(lot.start)||!Number.isSafeInteger(lot.end)||!Number.isSafeInteger(lot.untakenMinutes)||lot.untakenMinutes<=0||lot.untakenMinutes>lot.end-lot.start){issues.push('補休結清缺原加班日工資基礎或時數無效，需核定後才能發給 '+lot.id);continue;}
  if(tiers.some((t:any)=>!Number.isSafeInteger(t?.start)||!Number.isSafeInteger(t?.end)||t.end<=t.start||!positiveFraction(t.hourlyBasis)||!positiveFraction(t.multiplier))){issues.push('補休結清原日分段或金額證據無效 '+lot.id);continue;}
  // Only the actual untaken tail may be valued. Earlier used minutes must not
  // fill gaps, and overlapping tiers must not count the same minute twice.
  const tailStart=lot.end-lot.untakenMinutes;
  const own=tiers.map((t:any)=>({...t,start:Math.max(t.start,tailStart),end:Math.min(t.end,lot.end)})).filter((t:any)=>t.end>t.start).sort((a:any,c:any)=>a.start-c.start);
  let covered=tailStart;
  const continuous=own.every((t:any)=>{if(t.start!==covered)return false;covered=t.end;return true;});
  if(!continuous||covered!==lot.end){issues.push('補休結清原日分段重疊或不足以涵蓋未休時數 '+lot.id);continue;}
  own.reverse();
  let left=lot.untakenMinutes;const parts:CompSettlementItem['parts']=[],v:Rational[]=[];
  for(const t of own){if(!left)break;const take=Math.min(left,t.end-t.start),start=t.end-take;parts.unshift({start,end:t.end,minutes:take,hourlyBasis:t.hourlyBasis,multiplier:t.multiplier});v.push(mul(mul(f(t.hourlyBasis),f(t.multiplier)),rational(BigInt(take),60n)));left-=take;}
  const exact=sum(v);values.push(exact);items.push({lotId:lot.id,reason:due,minutes:lot.untakenMinutes,exact:evidence(exact),parts});
 }
 return {items,exact:evidence(sum(values)),issues};
}
