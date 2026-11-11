export const section48NoticeAddress="1 Beauchamp Court, 10 Victors Way, Barnet, Hertfordshire, England, EN5 5TZ";
export const standardPaymentTerms="Pursuant to the Section 48(1) of the Landlord and Tenant Act 1987, the address at which notices (including notices in proceedings) may be served by you is: 1 Beauhamp Court, 10 Victors Way, Barnet, Hertfordshire, England, EN5 5TZ\n\nService charges have now been applied to your account and any balance must be paid within 28 days. Please help your management company to meet its day-to-day expenses by paying your service charge today. When making a payment through your bank, please use the reference provided on your demand. Please see the payment advice below.";
export type ChargeDocumentSettings={noticeAddress:string;agentAddress:string;bankName:string;accountName:string;sortCode:string;accountNumber:string;paymentText:string};
export const blankDocumentSettings:ChargeDocumentSettings={noticeAddress:section48NoticeAddress,agentAddress:"",bankName:"",accountName:"",sortCode:"",accountNumber:"",paymentText:standardPaymentTerms};
export const documentFields:[keyof ChargeDocumentSettings,string][]=[["agentAddress","Managing agent address"],["bankName","Bank name"],["accountName","Account name"],["sortCode","Sort code"],["accountNumber","Account number"],["paymentText","Payment instructions / terms"]];

/** Statement guidance only; never invents a payment deadline or changes ledger data. */
export function statementPaymentMessage(balance:number,due:number,ready:boolean,paymentTerms:string):string{
 if(balance<0)return "Your account is in credit based on the recorded entries. No payment is currently due.";
 if(balance===0)return "Your account balance is zero based on the recorded entries. No payment is currently due.";
 if(due<=0)return "No payment is currently due based on the recorded due dates. See the account entries above for upcoming amounts.";
 if(!ready)return "This statement shows your recorded account balance. Document setup is incomplete; this is not a payment demand. Contact the managing team about any amount due.";
 return paymentTerms;
}
