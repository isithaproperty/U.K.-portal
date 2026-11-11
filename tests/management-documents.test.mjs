import test from "node:test";
import assert from "node:assert/strict";
import {prepareFinancialDraft,financialDraftToLedgerRows} from "../lib/financial-planning.ts";
import {generateFinancialDocuments,escapeDocumentHtml} from "../lib/management-documents.ts";
const batch={batchId:"doc-test-batch",blockId:1,kind:"Demand",preparedDate:"2026-11-02",issueDate:"2026-11-02",dueDate:"2026-12-01",issueMode:"Issue now, future due date",frequency:"Annual",yearStart:"2026-12-01",periodIndex:0,schedules:[{id:"main",name:"Estate <script>alert(1)</script>",annualPence:10000,shares:[{unitId:1,percentage:"50"},{unitId:2,percentage:"50"}]}]};
const state={version:1,blockId:1,kind:"Demand",schedules:[{id:"main",name:batch.schedules[0].name,amount:"100.00",percentages:{1:"50",2:"50"}}],frequency:batch.frequency,yearStart:batch.yearStart,periodIndex:0,issueMode:batch.issueMode,issueDate:batch.issueDate,dueDate:batch.dueDate,prepared:{input:batch,rows:prepareFinancialDraft(batch)}};
const units=[{id:1,blockId:1,unitNumber:"Flat 1",paymentReference:"FIXED1"},{id:2,blockId:1,unitNumber:"Flat 2",paymentReference:"FIXED2"}];
const context={state,revision:1,today:"2026-11-02",mode:"Draft",block:{id:1,name:"Example Court",address:"1 Example Road",managementCompany:"Example Landlord"},units};
const settings={noticeAddress:"Service address",agentAddress:"Agent address",bankName:"Example Bank",accountName:"Example Account",sortCode:"12-34-56",accountNumber:"12345678",paymentText:"Pay the stated amount by the exact due date above in accordance with your lease."};
async function ledgerFor(input=batch){return(await financialDraftToLedgerRows(input,units,true)).map((row,index)=>({...row,unit_id:index+1,reference:`INV-${index+1}`,due_date:row.due_date||null}));}
test("draft documents retain separate dates, exact unit scope, rights and unposted evidence",async()=>{
 const documents=await generateFinancialDocuments(context);
 assert.equal(documents.length,2);assert.equal(documents[0].posted,false);assert.ok(documents[0].body.includes("Preparation date: 2026-11-02"));assert.ok(documents[0].body.includes("Payment due date: 2026-12-01"));assert.ok(documents[0].body.includes("no matching ledger posting"));
 assert.ok(documents[0].body.includes("Summary of tenants’ rights"));assert.ok(!documents[0].body.includes("Flat 2"));assert.ok(documents[0].html.includes("&lt;script&gt;"));assert.ok(!documents[0].html.includes("<script>"));assert.ok(!documents[0].html.includes("onload="));
 assert.ok(Object.isFrozen(documents)&&Object.isFrozen(documents[0])&&Object.isFrozen(documents[0].attachment));assert.equal(documents[0].attachment.content,documents[0].body);assert.equal(documents[0].attachment.mediaType,"text/plain");
 assert.deepEqual(documents,await generateFinancialDocuments(context));
});
test("formal issue requires complete settings, reviewed landlord details and exact posted entries",async()=>{
 await assert.rejects(generateFinancialDocuments({...context,mode:"Issue"}),/formal demand blocked/);
 const ledgerEntries=await ledgerFor();
 const documentReview={landlordAddress:"Landlord registered address",wordingApproved:true};
 const documents=await generateFinancialDocuments({...context,mode:"Issue",settings,documentReview,ledgerEntries});
 assert.equal(documents[0].status,"Ready for issue");assert.equal(documents[0].posted,true);assert.deepEqual(documents[0].ledgerReferences,["INV-1"]);assert.equal(documents[0].missingRequirements.length,0);assert.ok(documents[0].body.includes("generation alone does not establish sending"));
 await assert.rejects(generateFinancialDocuments({...context,mode:"Issue",settings,documentReview,ledgerEntries:ledgerEntries.map(row=>({...row,amount_pence:1}))}),/Matching posted ledger/);
 await assert.rejects(generateFinancialDocuments({...context,mode:"Issue",settings,documentReview:{...documentReview,wordingApproved:false},ledgerEntries}),/Manager review/);
 const changed=await generateFinancialDocuments({...context,settings,documentReview,ledgerEntries});assert.notEqual(changed[0].contentHash,(await generateFinancialDocuments(context))[0].contentHash);
});
test("credit notes identify surplus reason, schedule, amount and posted CR reference without demanding payment",async()=>{
 const creditBatch={...batch,kind:"Surplus credit"};const creditState={...state,kind:"Surplus credit",prepared:{input:creditBatch,rows:prepareFinancialDraft(creditBatch)}};
 const ledgerEntries=(await ledgerFor(creditBatch)).map(row=>({...row,reference:row.reference.replace("INV","CR")}));
 const documents=await generateFinancialDocuments({...context,state:creditState,mode:"Issue",settings,documentReview:{landlordAddress:"Landlord address",wordingApproved:true},ledgerEntries});
 assert.equal(documents[0].kind,"Credit note");assert.ok(documents[0].body.includes("surplus allocation"));assert.ok(documents[0].body.includes("£50.00"));assert.ok(documents[0].body.includes("CR-1"));assert.ok(!documents[0].body.includes("Payment due date:"));assert.ok(!documents[0].body.includes("Summary of tenants’ rights"));assert.ok(documents[0].body.includes("does not assert that a cash refund"));
});
test("rejects stale unit scope, unsaved revision and empty prepared state",async()=>{
 await assert.rejects(generateFinancialDocuments({...context,revision:0}));await assert.rejects(generateFinancialDocuments({...context,units:units.slice(1)}));await assert.rejects(generateFinancialDocuments({...context,state:{...state,prepared:null}}));
 assert.equal(escapeDocumentHtml(`<a href="x">'&`),"&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
});

test("reference-inspired invoice layout keeps verified facts and never copies sample payments",async()=>{
 const [document]=await generateFinancialDocuments(context);
 assert.match(document.html,/<h1>Application For Payment<\/h1>/);
 assert.match(document.html,/ISSUE DATE:/);assert.match(document.html,/INVOICE REFERENCE: Not issued/);
 assert.match(document.html,/Description<\/th>/);assert.match(document.html,/class="value">Value/);
 assert.match(document.html,/50% of £100.00 annual budget/);
 assert.match(document.html,/Total amount demanded/);
 assert.match(document.html,/No payment receipt is asserted/);
 assert.match(document.body,/before separately recorded payments or credits/);
 assert.match(document.html,/Address for service of notices/);
 assert.match(document.html,/class="rights"/);assert.match(document.html,/break-before:page/);
 assert.match(document.html,/DRAFT - NOT ISSUED/);
 assert.match(document.html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
