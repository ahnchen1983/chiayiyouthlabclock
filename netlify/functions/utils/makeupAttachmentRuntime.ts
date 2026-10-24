/** No production adapter is installed in B4b. Tests inject adapters; no env switch enables them. */
export interface AttachmentPolicy {
 version:string; approved:true; required:boolean; maxFiles:number; maxBytes:number;
 allowedMime:string[]; draftWithdrawalAllowed:boolean;
}
export interface AttachmentRuntime {
 mode:'disabled'|'test-adapter'; policy:AttachmentPolicy|null;
 storage?:{putImmutable(key:string,bytes:Buffer,hash:string):Promise<void>;read(key:string):Promise<Buffer>};
 scanner?:{scan(bytes:Buffer):Promise<{verdict:'clean'|'blocked'|'error';mime:string;engine:string;version:string}>};
}
export const ATTACHMENT_TECH_LIMITS={bytes:2*1024*1024,files:5,grantSeconds:60};
export const getMakeupAttachmentRuntime=():AttachmentRuntime=>({mode:'disabled',policy:null});
