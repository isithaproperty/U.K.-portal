import test from "node:test";
import assert from "node:assert/strict";
import {inspectCashflowCsv,stageCashflowCsv,cashflowDateRange} from "../lib/building-cashflow.ts";
const mapping={date:"Date",reference:"Reference",description:"Description",amount:"Amount",credit:"",debit:"",transactionId:"ID",dateFormat:"UK"};
const csv='Date,Reference,Description,Amount,ID\n01/11/2026,RENT-A,Receipt,100,T1\n02/11/2026,SUPPLIER,Invoice,-50.50,T2\n03/11/2026,ZERO,Empty,0,T3';
test("cashflow retains signed income and expenditure, skips zero, and creates no allocations",()=>{
 const result=stageCashflowCsv(csv,mapping,"bank.csv");assert.equal(result.skipped,1);assert.deepEqual(result.rows.map(r=>r.amount_pence),[10000,-5050]);
 assert.deepEqual(result.rows.map(r=>r.transaction_date),["2026-11-01","2026-11-02"]);assert.equal("unit_id" in result.rows[0],false);assert.equal("payment_entry_id" in result.rows[0],false);
 assert.deepEqual(stageCashflowCsv(csv,mapping,"renamed.csv").rows.map(r=>r.fingerprint),result.rows.map(r=>r.fingerprint));
});
test("separate credit/debit mapping includes debit-only statements and rejects conflicting sides",()=>{
 const separate={...mapping,amount:"",credit:"In",debit:"Out",transactionId:""};
 const data='Date,Reference,Description,In,Out\n1/11/2026,A,Rent,100,\n2/11/2026,B,Repair,,20';
 assert.deepEqual(stageCashflowCsv(data,separate,"bank.csv").rows.map(r=>r.amount_pence),[10000,-2000]);
 assert.equal(stageCashflowCsv('Date,Reference,Description,Out\n1/11/2026,A,Repair,10',{...separate,credit:""},"bank.csv").rows[0].amount_pence,-1000);
 assert.throws(()=>stageCashflowCsv(data.replace('100,','100,5'),separate,"bank.csv"),/only one side/);
 assert.throws(()=>stageCashflowCsv(data,{...separate,amount:"In"},"bank.csv"),/OR/);
 assert.throws(()=>stageCashflowCsv(data,{...separate,debit:"In"},"bank.csv"),/different/);
});
test("fingerprints preserve repeated identical rows without IDs and are stable on overlap",()=>{
 const noId={...mapping,transactionId:""};const repeated='Date,Reference,Description,Amount,ID\n1/11/2026,A,Same,10,\n1/11/2026,A,Same,10,';
 const rows=stageCashflowCsv(repeated,noId,"bank.csv").rows;assert.notEqual(rows[0].fingerprint,rows[1].fingerprint);
 assert.equal(rows[0].fingerprint,stageCashflowCsv(repeated.split('\n').slice(0,2).join('\n'),noId,"overlap.csv").rows[0].fingerprint);
 const sameId=csv.replace('T2','T1');assert.throws(()=>stageCashflowCsv(sameId,mapping,"bank.csv"),/Repeated bank transaction ID/);
});
test("inspection handles quotes/BOM and rejects invalid dimensions, mapping and values",()=>{
 assert.equal(inspectCashflowCsv('\uFEFFDate,Reference\r\n"1/11/2026","A, B"').sample[0][1],'A, B');
 for(const text of ['', 'A,A\n1,2','A,\n1,2','A,B\n1','A\n'+Array(1001).fill('1').join('\n')])assert.throws(()=>inspectCashflowCsv(text));
 assert.throws(()=>stageCashflowCsv(csv,{...mapping,date:"Missing"},"bank.csv"));
 assert.throws(()=>stageCashflowCsv(csv.replace('100,T1','NaN,T1'),mapping,"bank.csv"));
 assert.throws(()=>stageCashflowCsv(csv.replace('01/11/2026','31/11/2026'),mapping,"bank.csv"));
 assert.throws(()=>stageCashflowCsv(csv,{...mapping,amount:null},"bank.csv"));
});
test("date range validates boundaries without inventing dates",()=>{
 assert.deepEqual(cashflowDateRange(null,null),{start:null,end:null});
 assert.deepEqual(cashflowDateRange('2026-01-01','2026-12-31'),{start:'2026-01-01',end:'2026-12-31'});
 assert.throws(()=>cashflowDateRange('2026-02-30',null));assert.throws(()=>cashflowDateRange('2026-12-31','2026-01-01'));
});
