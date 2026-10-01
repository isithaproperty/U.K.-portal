export const section48NoticeAddress="1 Beauchamp Court, 10 Victors Way, Barnet, Hertfordshire, England, EN5 5TZ";
export type ChargeDocumentSettings={noticeAddress:string;agentAddress:string;bankName:string;accountName:string;sortCode:string;accountNumber:string;paymentText:string};
export const blankDocumentSettings:ChargeDocumentSettings={noticeAddress:section48NoticeAddress,agentAddress:"",bankName:"",accountName:"",sortCode:"",accountNumber:"",paymentText:""};
export const documentFields:[keyof ChargeDocumentSettings,string][]=[["noticeAddress","Section 48 notice address"],["agentAddress","Managing agent address"],["bankName","Bank name"],["accountName","Account name"],["sortCode","Sort code"],["accountNumber","Account number"],["paymentText","Payment instructions / terms"]];
