import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('service-charge navigation reuses manager-scoped financial and delivery components',async()=>{
 const service=await readFile(new URL('../app/ServiceChargeRegister.tsx',import.meta.url),'utf8');
 const portal=await readFile(new URL('../app/Portal.tsx',import.meta.url),'utf8');
 assert.match(service,/aria-label="Service charge areas"/);
 assert.match(service,/isManager&&/);assert.match(service,/Budget & financials/);
 assert.match(service,/opened.budgets&&<FinancialPlanning/);assert.match(service,/opened.delivery&&<DeliveryRegister preparationScope="service-charges"/);
 assert.match(portal,/<ServiceChargeRegister isManager={isManager} canPostBatches={canPostBatches}/);
});
test('import summary approval is separate and persistence carries building-year budget evidence',async()=>{
 const importer=await readFile(new URL('../app/BudgetCsvImport.tsx',import.meta.url),'utf8');
 const planning=await readFile(new URL('../app/FinancialPlanning.tsx',import.meta.url),'utf8');
 assert.match(importer,/checked={summaryApproved}/);assert.match(importer,/checked={reviewed}/);
 assert.match(importer,/summaryApproved\?{blockId,yearStart:budgetStart/);
 assert.match(planning,/setRecipientBudgets\(state.recipientBudgets\?\?\[\]\)/);
 assert.match(planning,/prepared,recipientBudgets,initialDemand/);
 assert.match(planning,/useState<boolean\|undefined>\(undefined\)/);
 assert.match(planning,/No resident-facing budget summary retained/);
});

test('budget workflow has one production home with original styling and intact Excel support',async()=>{
 const service=await readFile(new URL('../app/ServiceChargeRegister.tsx',import.meta.url),'utf8');
 const management=await readFile(new URL('../app/ManagementReview.tsx',import.meta.url),'utf8');
 const portal=await readFile(new URL('../app/Portal.tsx',import.meta.url),'utf8');
 const importer=await readFile(new URL('../app/BudgetCsvImport.tsx',import.meta.url),'utf8');
 assert.match(service,/className="management-review"/);assert.match(service,/import "\.\/management-review.css"/);
 assert.doesNotMatch(management,/FinancialPlanning|Budget & financials/);
 for(const label of ['Leaseholders & Section 20','Debtors','Creditors','Standing orders','Delivery & alerts'])assert.ok(management.includes(label));
 assert.match(management,/tab!==2}><CreditorRegister/);assert.match(portal,/onOpenCreditors={id=>{setReviewTab\(2\)/);
 assert.match(importer,/accept="\.xlsx,\.csv/);assert.match(importer,/parseBudgetWorkbook/);assert.match(importer,/inspectBudgetCsv/);
});
test('delivery preparation is separated but shared queue processing is described honestly',async()=>{
 const delivery=await readFile(new URL('../app/DeliveryRegister.tsx',import.meta.url),'utf8');
 const management=await readFile(new URL('../app/ManagementReview.tsx',import.meta.url),'utf8');
 assert.match(management,/preparationScope="management"/);
 assert.match(delivery,/preparationScope!=="management"&&<><option value="financial"/);
 assert.match(delivery,/preparationScope!=="service-charges"&&<option value="section20"/);
 assert.match(delivery,/Process enabled approved due building messages/);
 assert.match(delivery,/not just the preparation type shown above/);
});
