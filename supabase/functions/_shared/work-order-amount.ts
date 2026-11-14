/** Only explicitly approved order costs or the order estimate belong in contractor documents. */
export type WorkOrderAmount={amountPence:number|null;basis:'Agreed'|'Estimated'|'Not recorded';isOngoing:boolean};
function pence(value:unknown){
 if(value===null||value===undefined||value==='')return null;
 if(typeof value!=='string'&&typeof value!=='number')return null;
 const amount=Number(value),rounded=Math.round(amount*100);
 return Number.isFinite(amount)&&amount>=0&&Number.isSafeInteger(rounded)&&Math.abs(amount*100-rounded)<0.00001?rounded:null;
}
export function workOrderAmount(order:{estimated_cost?:unknown;actual_cost?:unknown;payment_status?:unknown;is_ongoing?:unknown}):WorkOrderAmount{
 const approved=['Approved','Paid'].includes(String(order.payment_status))?pence(order.actual_cost):null;
 const estimate=pence(order.estimated_cost);
 return {amountPence:approved??estimate,basis:approved!==null?'Agreed':estimate!==null?'Estimated':'Not recorded',isOngoing:order.is_ongoing===true};
}
export function workOrderAmountDisplay(amount?:WorkOrderAmount){
 if(!amount)return {label:'Order amount',value:'Not recorded in this sent work order',note:'Contact the managing team to confirm the agreed amount. Earlier dispatch snapshots are unchanged.'};
 const label=amount.isOngoing?`${amount.basis==='Not recorded'?'':amount.basis+' '}ongoing contract total`:`${amount.basis==='Not recorded'?'Order':amount.basis+' order'} amount`;
 return {label,value:amount.amountPence===null?'Not recorded':new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(amount.amountPence/100),note:amount.isOngoing?'For an annual contract this is the annual total, not each monthly invoice amount. Follow the agreed billing schedule.':'Use the agreed scope and payment terms. This amount does not confirm payment.'};
}
