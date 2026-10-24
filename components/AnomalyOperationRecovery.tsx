import React,{useState} from 'react';
import {useAnomalyOperation} from '../hooks/useAnomalyOperation';
export default function AnomalyOperationRecovery({onResolved}:{onResolved?:()=>void}){
 const op=useAnomalyOperation(),[error,setError]=useState('');
 if(op.blocked)return <p role="alert">異常／追補操作暫存無法確認，禁止新寫入；請保留分頁核實。</p>;
 if(!op.pending)return null;
 return <div className="border p-3 break-all"><p>異常／追補操作結果未確認：{op.pending.command.caseId}。GET、切頁與重新整理不代表成功；不自動重送或更換識別。</p>{error&&<p role="alert">{error}</p>}<button type="button" disabled={op.busy} onClick={async()=>{try{await op.attempt(op.pending!);setError('');onResolved?.();}catch{setError('原操作尚未確認或遭拒，請保留識別核實，不能另送相同內容。');}}}>重試原異常／追補操作</button></div>;
}
