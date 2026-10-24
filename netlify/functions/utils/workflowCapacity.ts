/** Retained inactive/history links count too. All callers use the shared transaction gate. */
export async function assertWorkflowCapacity(db:any,tx:any,collection:string,pairs:{id:string;caseId:string;sourceId:string}[]){
 for(const field of ['caseId','sourceId'])for(const value of new Set(pairs.map(p=>p[field]))){
  const snap=await tx.get(db.collection(collection).where(field,'==',value).limit(101));
  const ids=new Set(snap.docs.map((d:any)=>d.id));for(const p of pairs.filter(p=>p[field]===value))ids.add(p.id);
  if(ids.size>100)throw Object.assign(new Error('來源關聯達技術容量上限，未部分寫入'),{statusCode:409});
 }
}
