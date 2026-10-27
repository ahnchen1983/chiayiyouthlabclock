import type {AttachmentRuntime} from '../../netlify/functions/utils/makeupAttachmentRuntime';
import {createHash} from 'node:crypto';
/** Synthetic fixture only. No network, URLs, cloud credentials or malware claims. */
export const syntheticAttachmentRuntime=(required=false)=>{
 const objects=new Map<string,Buffer>();let verdict:'clean'|'blocked'|'error'='clean';let writes=0;
 const runtime:AttachmentRuntime={mode:'test-adapter',policy:{version:'synthetic-policy-v1',approved:true,required,maxFiles:2,maxBytes:1024,allowedMime:['application/pdf'],draftWithdrawalAllowed:true},storage:{async putImmutable(key,b,h){if(!/^[a-f0-9]{64}$/.test(key))throw Error('unsafe key');const old=objects.get(key);if(old&&createHash('sha256').update(old).digest('hex')!==h)throw Error('immutable');if(!old)writes++;objects.set(key,Buffer.from(b));},async read(key){if(!objects.has(key))throw Error('missing');return Buffer.from(objects.get(key)!);}},scanner:{async scan(){return {verdict,mime:'application/pdf',engine:'synthetic-fixture-only',version:'v1'};}}};
 return {runtime,objects,setVerdict:(v:typeof verdict)=>{verdict=v;},get writes(){return writes;}};
};
export const syntheticPdf=Buffer.from('%PDF-1.4\nsynthetic attachment only\n%%EOF').toString('base64');
