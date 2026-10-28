// Generic exact arithmetic, not a universal statutory net-pay rounding policy.
// Company confirmed final-total stage only; mode/increment still require approval.
// C3 must preserve item-specific statutory rounding instead of applying this rule
// over insurance again: BLI https://www.bli.gov.tw/0006443.html point 4;
// NHI Rules Art.52 https://law.moj.gov.tw/LawClass/LawSingle.aspx?flno=52&pcode=L0060002
// Sources checked 2026-10-24; do not infer historical August applicability from that date.
/** Exact decimal/rational arithmetic. JSON evidence uses strings, never BigInt. */
export type Rational = { n: bigint; d: bigint };
export type FractionEvidence = { numerator: string; denominator: string };
export interface RoundingPolicy {
 version: string; status: 'approved'; approvedBy: string; approvedAt: string;
 stage: 'per-item' | 'final'; precision: 0 | 2; mode: 'half-up' | 'half-even' | 'toward-zero';
}
const gcd=(a:bigint,b:bigint):bigint=>b?gcd(b,a%b):a<0n?-a:a;
export function rational(n:bigint,d=1n):Rational {if(!d)throw Error('zero denominator');if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return {n:n/g,d:d/g};}
export function decimal(v:string|number):Rational {
 const s=String(v);if(!/^-?\d{1,12}(\.\d{1,8})?$/.test(s))throw Error('invalid exact decimal');
 const [a,b='']=s.split('.');return rational(BigInt(a+b),10n**BigInt(b.length));
}
export const add=(a:Rational,b:Rational)=>rational(a.n*b.d+b.n*a.d,a.d*b.d);
export const mul=(a:Rational,b:Rational)=>rational(a.n*b.n,a.d*b.d);
export const evidence=(a:Rational):FractionEvidence=>({numerator:a.n.toString(),denominator:a.d.toString()});
export const sum=(a:Rational[])=>a.reduce(add,rational(0n));
export function validRounding(p:any):p is RoundingPolicy {return p?.status==='approved'&&typeof p.version==='string'&&!!p.version&&typeof p.approvedBy==='string'&&!!p.approvedBy&&Number.isFinite(Date.parse(p.approvedAt))&&['per-item','final'].includes(p.stage)&&[0,2].includes(p.precision)&&['half-up','half-even','toward-zero'].includes(p.mode);}
export function rounded(a:Rational,p:RoundingPolicy):string {
 if(!validRounding(p))throw Error('rounding policy unreviewed');const scale=10n**BigInt(p.precision),negative=a.n<0n,n=(negative?-a.n:a.n)*scale;let q=n/a.d;const rem=n%a.d;
 if(p.mode!=='toward-zero'&&(2n*rem>a.d||2n*rem===a.d&&(p.mode==='half-up'||q%2n===1n)))q++;
 const digits=q.toString().padStart(p.precision+1,'0');return (negative&&q!==0n?'-':'')+(p.precision?digits.slice(0,-p.precision)+'.'+digits.slice(-p.precision):digits);
}
