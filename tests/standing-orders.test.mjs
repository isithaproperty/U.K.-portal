import test from "node:test";
import assert from "node:assert/strict";
import {validateStandingOrder,standingOrderOccurrences,exactStandingOrderMatches} from "../lib/standing-orders.ts";
const config={unitId:1,amountPence:12500,startDate:"2026-01-31",cadence:"quarterly",dueOffsetDays:30,invoiceMode:"invoice_review",allocationMode:"allocation_review",enabled:false,leaseConfirmed:false,leaseReference:""};
test("schedule dates retain original month-end anchor with separate due dates",()=>{
 const periods=standingOrderOccurrences(config,"2026-11-02");
 assert.deepEqual(periods.map(p=>p.issueDate),["2026-01-31","2026-04-30","2026-07-31","2026-10-31"]);
 assert.equal(periods[0].dueDate,"2026-03-02");
 assert.deepEqual(standingOrderOccurrences(config,"2026-01-30"),[]);
 assert.equal(new Set(periods.map(p=>p.key)).size,periods.length);
 assert.equal(standingOrderOccurrences({...config,cadence:"annual"},"2027-01-31").length,2);
 assert.equal(standingOrderOccurrences({...config,cadence:"half_yearly"},"2026-11-02").length,2);
 assert.throws(()=>standingOrderOccurrences({...config,startDate:"2000-01-31"},"2200-01-31"),/500 historical/);
});
test("English quarter days are exact across year boundaries and governed by the lease",()=>{
 const q={...config,startDate:"2026-09-29",cadence:"english_quarterly"};
 assert.deepEqual(standingOrderOccurrences(q,"2027-06-24").map(p=>p.issueDate),["2026-09-29","2026-12-25","2027-03-25","2027-06-24"]);
 assert.throws(()=>validateStandingOrder({...q,startDate:"2026-09-30"},[1]));
});
test("enabling requires lease confirmation, valid scoped unit and complete bounded amounts",()=>{
 assert.equal(validateStandingOrder(config,[1]).enabled,false);
 for(const change of [{enabled:true},{enabled:true,leaseConfirmed:true},{unitId:2},{amountPence:0},{amountPence:1.5},{amountPence:100000001},{startDate:"2026-02-29"},{dueOffsetDays:-1},{dueOffsetDays:366},{cadence:"monthly"},{invoiceMode:"anything"}])assert.throws(()=>validateStandingOrder({...config,...change},[1]));
 assert.equal(validateStandingOrder({...config,enabled:true,leaseConfirmed:true,leaseReference:" Lease clause 4 "},[1]).leaseReference,"Lease clause 4");
});
test("auto allocation matches actual pending receipts only: exact amount, account reference and block",()=>{
 const enabled={...config,enabled:true,leaseConfirmed:true,leaseReference:"Lease",allocationMode:"auto_exact_match"};
 const row={id:1,blockId:10,transactionDate:"2026-10-01",amountPence:12500,reference:" ab 12 ",status:"Pending"};
 assert.deepEqual(exactStandingOrderMatches(enabled,10,"AB12",[row],"2026-11-02",1),[{id:1,unit_id:1}]);
 for(const changed of [{blockId:11},{amountPence:12501},{reference:"AB123"},{reference:"Payment AB12"},{status:"Posted"},{transactionDate:"2026-12-01"},{transactionDate:"2025-12-01"}])assert.deepEqual(exactStandingOrderMatches(enabled,10,"AB12",[{...row,...changed}],"2026-11-02",1),[]);
 assert.deepEqual(exactStandingOrderMatches(enabled,10,"AB12",[],"2026-11-02",1),[]);
 assert.deepEqual(exactStandingOrderMatches(enabled,10,"AB12",[row],"2026-11-02",2),[]);
 assert.deepEqual(exactStandingOrderMatches(enabled,10,null,[row],"2026-11-02",1),[]);
 assert.deepEqual(exactStandingOrderMatches({...enabled,enabled:false},10,"AB12",[row],"2026-11-02",1),[]);
 assert.deepEqual(exactStandingOrderMatches({...enabled,allocationMode:"allocation_review"},10,"AB12",[row],"2026-11-02",1),[]);
});
