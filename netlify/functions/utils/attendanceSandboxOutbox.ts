import { randomUUID } from 'node:crypto';
import { evidenceHash } from './attendanceCaseLifecycle';
export interface SandboxAdapter { kind:'sandbox'; deliver:(idempotencyKey:string)=>Promise<{receipt:string}> }
// Deliberately not a deployed function or scheduled export. Disabled by default,
// and opt-in execution additionally requires the explicit local demo emulator.
export const runSandboxOutbox=async(db:any,id:string,adapter:SandboxAdapter,options:{enabled?:boolean;clock?:()=>number}={})=>{
 if(!options.enabled)return {disabled:true};
 if(adapter.kind!=='sandbox'||!/^127\.0\.0\.1:(8086|8087)$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||process.env.FIREBASE_PROJECT_ID!=='demo-chiayi-payroll')throw new Error('Sandbox delivery requires the explicit demo emulator');
 if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid outbox id');
 const now=options.clock?.()??Date.now(),leaseToken=randomUUID(),ref=db.collection('attendanceCaseOutbox').doc(id);
 const claim=await db.runTransaction(async(tx:any)=>{
  const snap=await tx.get(ref);if(!snap.exists)return null;const job=snap.data();
  if(job.channel!=='sandbox'||job.policyVersion!=='sandbox-retry-v1'||!job.recipientId)throw new Error('Unsupported outbox policy/channel/recipient');
  if(['delivered','dead-letter','unknown-delivery'].includes(job.state))return null;
  if(!['held','queued','retry','leased'].includes(job.state))throw new Error('Unknown outbox state');
  if(job.state==='leased'&&Date.parse(job.leaseExpiresAt)>now)return null;
  if(job.nextAttemptAt&&Date.parse(job.nextAttemptAt)>now)return null;
  if(!Number.isInteger(job.attempts)||job.attempts<0)throw new Error('Invalid attempts');
  if(job.attempts>=3){tx.update(ref,{state:'dead-letter',leaseToken:null,leaseExpiresAt:null});return null;}
  const attempt=job.attempts+1;
  tx.update(ref,{state:'leased',attempts:attempt,leaseToken,leaseExpiresAt:new Date(now+60000).toISOString()});
  tx.create(db.collection('attendanceOutboxEvents').doc(evidenceHash([id,attempt,'claim'])),{outboxId:id,attempt,phase:'claim',at:new Date(now).toISOString()});
  return {attempt};
 });
 if(!claim)return {claimed:false};
 let receipt:string|null=null,failed=false;
 try{const result=await adapter.deliver(id);if(typeof result.receipt!=='string'||!result.receipt||result.receipt.length>200)throw new Error('Invalid sandbox receipt');receipt=result.receipt;}catch{failed=true;}
 return db.runTransaction(async(tx:any)=>{
  const snap=await tx.get(ref);if(!snap.exists||snap.data().leaseToken!==leaseToken)return {staleLease:true};
  const state=failed?(claim.attempt>=3?'dead-letter':'retry'):'delivered';
  const nextAttemptAt=state==='retry'?new Date(now+60000*2**(claim.attempt-1)).toISOString():null;
  tx.update(ref,{state,nextAttemptAt,leaseToken:null,leaseExpiresAt:null,deliveryEvidence:receipt,lastFailureCode:failed?'SANDBOX_DELIVERY_FAILED':null});
  tx.create(db.collection('attendanceOutboxEvents').doc(evidenceHash([id,claim.attempt,'result'])),{outboxId:id,attempt:claim.attempt,phase:'result',state,at:new Date(now).toISOString()});
  return {claimed:true,state,attempt:claim.attempt};
 });
};
