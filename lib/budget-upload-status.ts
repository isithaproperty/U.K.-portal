export type BudgetFileStatus={name:string;phase:"reading"|"ready"|"error";error?:string};
export function budgetFileMessage(status:BudgetFileStatus,nextStep:string):string{
 if(status.phase==="reading")return `Reading ${status.name}…`;
 if(status.phase==="error")return `Could not read ${status.name}: ${status.error||"Please choose the file again."}`;
 return `Read ${status.name} successfully in this browser. ${nextStep}`;
}
