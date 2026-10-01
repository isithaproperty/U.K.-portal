export type ChargeEntry={id:number;block_id:number;unit_id:number;entry_type:"Charge"|"Payment"|"Credit";description:string;amount_pence:number;entry_date:string;due_date:string|null;reference:string};
export function money(pence:number){return new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP"}).format(pence/100);}
export function chargeSummary(entries:ChargeEntry[],today:string){
 const posted=entries.filter(e=>e.entry_date<=today);
 const charges=posted.filter(e=>e.entry_type==="Charge").sort((a,b)=>(a.due_date??a.entry_date).localeCompare(b.due_date??b.entry_date)||a.id-b.id);
 const totalCharges=charges.reduce((n,e)=>n+e.amount_pence,0);
 const payments=posted.filter(e=>e.entry_type==="Payment").reduce((n,e)=>n+e.amount_pence,0);
 const credits=posted.filter(e=>e.entry_type==="Credit").reduce((n,e)=>n+e.amount_pence,0);
 let available=payments+credits,overdue=0,due=0;
 const remaining:Record<number,number>={};
 for(const e of charges){const applied=Math.min(available,e.amount_pence);available-=applied;const outstanding=e.amount_pence-applied;remaining[e.id]=outstanding;if(e.due_date&&e.due_date<=today)due+=outstanding;if(e.due_date&&e.due_date<today)overdue+=outstanding;}
 return {balance:totalCharges-payments-credits,totalCharges,payments,credits,due,overdue,remaining};
}
export function londonDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
