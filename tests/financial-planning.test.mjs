import test from "node:test";
import assert from "node:assert/strict";
import {apportionLeaseBudget,parsePounds,planningPeriods,prepareFinancialDraft,validPlanningDate} from "../lib/financial-planning.ts";
const shares=[{unitId:1,percentage:"33.3333"},{unitId:2,percentage:"33.3333"},{unitId:3,percentage:"33.3334"}];
const input={batchId:"review-1",blockId:1,kind:"Demand",preparedDate:"2026-11-02",issueDate:"2026-11-02",dueDate:"2026-12-01",issueMode:"Issue now, future due date",frequency:"Quarterly",yearStart:"2026-12-01",periodIndex:0,schedules:[{id:"main",name:"Main lease schedule",annualPence:10001,shares}]};
test("apportionment retains every penny and respects zero/excluded shares",()=>{
 const rows=apportionLeaseBudget(10001,shares);assert.equal(rows.reduce((sum,row)=>sum+row.amountPence,0),10001);
 assert.equal(apportionLeaseBudget(1,[{unitId:1,percentage:"0"},{unitId:2,percentage:"100"}])[0].amountPence,0);
 assert.deepEqual(apportionLeaseBudget(1,[{unitId:2,percentage:"50"},{unitId:1,percentage:"50"}]),[{unitId:2,amountPence:0},{unitId:1,amountPence:1}]);
});
test("rejects missing, duplicate, imprecise and incomplete lease inputs",()=>{
 for(const values of [[],[{unitId:1,percentage:"50"}],[{unitId:1,percentage:"100"},{unitId:1,percentage:"0"}],[{unitId:1,percentage:"100.00001"}],[{unitId:1,percentage:""}],[{unitId:1,percentage:"-1"}]])assert.throws(()=>apportionLeaseBudget(100,values));
 for(const value of [0,-1,0.5,NaN,Infinity,1000000000])assert.throws(()=>apportionLeaseBudget(value,shares));
 for(const value of ["","0","-1","1.001","1e3","1,000"])assert.throws(()=>parsePounds(value));
 assert.equal(parsePounds("1.01"),101);
});
test("English quarter periods use actual quarter days and roll year",()=>{
 assert.deepEqual(planningPeriods("2026-09-29","English quarters"),[{start:"2026-09-29",end:"2026-12-24"},{start:"2026-12-25",end:"2027-03-24"},{start:"2027-03-25",end:"2027-06-23"},{start:"2027-06-24",end:"2027-09-28"}]);
 assert.throws(()=>planningPeriods("2026-03-24","English quarters"));
 assert.equal(planningPeriods("2024-02-29","Annual")[0].end,"2025-02-27");
 assert.equal(validPlanningDate("2026-02-30"),false);
});
test("annual allocations reconcile over all instalments and retries have stable keys",()=>{
 const rows=[0,1,2,3].flatMap(periodIndex=>prepareFinancialDraft({...input,periodIndex}));
 assert.equal(rows.reduce((sum,row)=>sum+row.amountPence,0),10001);
 assert.equal(new Set(rows.map(row=>row.idempotencyKey)).size,12);
 assert.deepEqual(prepareFinancialDraft(input),prepareFinancialDraft(input));
 assert.equal(rows[0].dueDate,"2026-12-01");assert.equal(rows[0].preparedDate,"2026-11-02");
});
test("validates schedule and future demand date relationships",()=>{
 for(const patch of [{dueDate:"2026-11-01"},{issueDate:"2026-11-01"},{issueMode:"Schedule for later"},{issueDate:"2026-12-01"},{periodIndex:4},{schedules:[]},{schedules:[input.schedules[0],input.schedules[0]]},{schedules:[{...input.schedules[0],name:""}]}])assert.throws(()=>prepareFinancialDraft({...input,...patch}));
 const rows=prepareFinancialDraft({...input,issueMode:"Schedule for later",issueDate:"2026-11-20"});assert.equal(rows[0].plannedIssueDate,"2026-11-20");
});
test("surplus credits apportion the whole surplus and never acquire a payment due date",()=>{
 const rows=prepareFinancialDraft({...input,kind:"Surplus credit",yearStart:"",periodIndex:-1});
 assert.equal(rows.reduce((sum,row)=>sum+row.amountPence,0),10001);
 assert.ok(rows.every(row=>row.entryType==="Credit"&&row.dueDate===null&&row.chargePeriod===null));
});

test("saved preparation validates block and units and recalculates stored allocations",async()=>{
 const {validateFinancialState}=await import("../lib/financial-planning.ts");
 const state={version:1,blockId:1,kind:input.kind,schedules:[{id:"main",name:"Main lease schedule",amount:"100.01",percentages:{1:"33.3333",2:"33.3333",3:"33.3334"}}],frequency:input.frequency,yearStart:input.yearStart,periodIndex:0,issueMode:input.issueMode,issueDate:input.issueDate,dueDate:input.dueDate,prepared:{input,rows:[{amountPence:999999999}]}};
 const validated=validateFinancialState(state,1,[1,2,3],"2026-11-02");
 assert.deepEqual(validated.prepared.rows,prepareFinancialDraft(input));
 assert.throws(()=>validateFinancialState(state,2,[1,2,3],"2026-11-02"));
 assert.throws(()=>validateFinancialState(state,1,[1,2],"2026-11-02"));
 assert.throws(()=>validateFinancialState({...state,schedules:[{...state.schedules[0],amount:"200.00"}]},1,[1,2,3],"2026-11-02"));
 assert.throws(()=>validateFinancialState({...state,prepared:{input:{...input,preparedDate:"2026-11-03"}}},1,[1,2,3],"2026-11-02"));
 assert.equal(validateFinancialState({...state,prepared:null,schedules:[{...state.schedules[0],name:"",amount:"",percentages:{}}]},1,[1,2,3],"2026-11-02").prepared,null);
});
test("ledger conversion requires approval, scopes units and generates repeatable distinct UUID requests",async()=>{
 const {financialDraftToLedgerRows}=await import("../lib/financial-planning.ts");
 const units=[1,2,3].map(id=>({id,blockId:1,unitNumber:`Flat ${id}`}));
 await assert.rejects(financialDraftToLedgerRows(input,units,false));
 await assert.rejects(financialDraftToLedgerRows(input,units.slice(1),true));
 await assert.rejects(financialDraftToLedgerRows(input,units.map(unit=>({...unit,blockId:2})),true));
 const rows=await financialDraftToLedgerRows(input,units,true);
 assert.deepEqual(rows,await financialDraftToLedgerRows(input,units,true));
 assert.equal(new Set(rows.map(row=>row.request_id)).size,3);
 assert.ok(rows.every(row=>/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.request_id)&&row.reference===""&&row.due_date==="2026-12-01"&&row.entry_date==="2026-11-02"));
 const credit=await financialDraftToLedgerRows({...input,kind:"Surplus credit"},units,true);
 assert.ok(credit.every(row=>row.entry_type==="Credit"&&row.due_date===""));
});

test("imported annual budgets keep stable identity across retries and reject changed year or random batch ids",()=>{
 const id="import-budget:1:2026-12-01";
 const imported={...input,frequency:"Annual",batchId:id,schedules:[{...input.schedules[0],id}]};
 const first=prepareFinancialDraft(imported);
 const renamed=prepareFinancialDraft({...imported,schedules:[{...imported.schedules[0],name:"Renamed column"}]});
 assert.deepEqual(first.map(row=>row.idempotencyKey),renamed.map(row=>row.idempotencyKey));
 assert.throws(()=>prepareFinancialDraft({...imported,batchId:"new-random-id"}));
 assert.throws(()=>prepareFinancialDraft({...imported,yearStart:"2027-12-01"}));
});
