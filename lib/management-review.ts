import {validateBudgetSpendState} from "./budget-spend.ts";
import {validateFinancialState} from "./financial-planning.ts";
import {validateDebtorState} from "./debtors.ts";
import {validateLeaseholderState} from "./leaseholder-planning.ts";
import {validateCreditorState} from "./creditors.ts";
import type {WorkOrder} from "../app/types";
export const reviewAreas=["financials","leaseholders","debtors","creditors","budget-spend"] as const;
export type ReviewArea=typeof reviewAreas[number];
export function isReviewArea(value:string):value is ReviewArea{return (reviewAreas as readonly string[]).includes(value);}
export function canManageReviewBlock(member:{role:string;portfolio_manager:string|null}|null,manager:string){
 return !!member&&(member.role==="owner"||member.role==="admin"||(member.role==="manager"&&!!member.portfolio_manager&&member.portfolio_manager===manager));
}
export function validateReviewWrite(body:unknown){
 if(!body||typeof body!=="object"||Array.isArray(body))throw new Error("Provide review state and its revision.");
 const {state,revision}=body as Record<string,unknown>;
 if(!Number.isSafeInteger(revision)||(revision as number)<0)throw new Error("A valid loaded revision is required.");
 if(!state||typeof state!=="object"||Array.isArray(state))throw new Error("Review state must be an object.");
 return {state,revision:revision as number};
}
export function validateReviewState(area:ReviewArea,state:unknown,blockId:number,unitIds:number[],today:string,orders:WorkOrder[]=[]){
 switch(area){
 case "budget-spend":return validateBudgetSpendState(state,blockId,orders);
 case "financials":return validateFinancialState(state,blockId,unitIds,today);
 case "leaseholders":return validateLeaseholderState(state,blockId,unitIds,today);
 case "debtors":return validateDebtorState(state,blockId,unitIds,today);
 case "creditors":return validateCreditorState(state,orders,blockId,today);
 }
}
