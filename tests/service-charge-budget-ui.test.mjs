import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('service-charge navigation reuses manager-scoped financial and delivery components',async()=>{
 const service=await readFile(new URL('../app/ServiceChargeRegister.tsx',import.meta.url),'utf8');
 const portal=await readFile(new URL('../app/Portal.tsx',import.meta.url),'utf8');
 assert.match(service,/aria-label="Service charge areas"/);
 assert.match(service,/isManager&&/);assert.match(service,/Budgets & service charge demands/);
 assert.match(service,/opened.budgets&&<FinancialPlanning/);assert.match(service,/opened.delivery&&<DeliveryRegister/);
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
