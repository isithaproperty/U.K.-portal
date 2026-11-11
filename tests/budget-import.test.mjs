import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,inspectBudgetCsv,buildBudgetPreview,parseUnitSharesCsv,reconcileShares,sourcePercentageString} from '../lib/budget-import.ts';
const csv='Block Name,Sample Court,,\r\nFrom,01/10/2026,,\r\nTo,2027-09-30,,\r\n,,,\r\nCategoryName,Budget 2025 - 2026,Budget 2026 - 2027,Notes\r\nCleaning,200,300,"New, contract"\r\nElectricity,100,0,\r\n,300,300,';
test('CSV quotes, escaped quotes, BOM and newlines',()=>{
 assert.deepEqual(parseCsv('\uFEFFa,b\r\n"x,y","a""b\nc"\r\n'),[['a','b'],['x,y','a"b\nc']]);
 for(const bad of ['','"unclosed','a"b,c','"a"b,c'])assert.throws(()=>parseCsv(bad));
 assert.throws(()=>parseCsv('x'.repeat(2*1024*1024+1)));
 assert.throws(()=>parseCsv('a\n'.repeat(1001)));
});
test('Summary preview uses selected year only, validates totals and zero rows',()=>{
 const table=inspectBudgetCsv(csv);assert.equal(table.blockName,'Sample Court');assert.equal(table.startDate,'2026-10-01');assert.equal(table.endDate,'2027-09-30');
 assert.deepEqual(buildBudgetPreview(table,2),{categories:[{name:'Cleaning',amountPence:30000},{name:'Electricity',amountPence:0}],totalPence:30000});
 assert.equal(buildBudgetPreview(table,1).totalPence,30000);
 assert.throws(()=>buildBudgetPreview(table,0));assert.throws(()=>buildBudgetPreview(table,3));
 assert.throws(()=>buildBudgetPreview(inspectBudgetCsv(csv.replace(',300,300,',',300,301,')),2));
 assert.throws(()=>inspectBudgetCsv(csv.replace('01/10/2026','31/02/2026')));
});
test('Malformed amounts, missing cells, duplicate categories and formulas rejected',()=>{
 for(const value of ['-1','1e3','=100','1.001','','£1,00'])assert.throws(()=>buildBudgetPreview(inspectBudgetCsv(`CategoryName,Budget\nTest,"${value}"`),1));
 assert.throws(()=>buildBudgetPreview(inspectBudgetCsv('CategoryName,Budget\nTest,1\ntest,2'),1));
 assert.throws(()=>buildBudgetPreview(inspectBudgetCsv('CategoryName,Budget\nTest,1\n,2'),1));
 assert.equal(buildBudgetPreview(inspectBudgetCsv('Category Name,Budget\nTest,"£1,234.56"\nTotal,"1,234.56"'),1).totalPence,123456);
});
test('Unit share import preserves code and labels without trusting external IDs',()=>{
 const unitCsv='ID,Unit Code,Unit Name,Service Charge (Percentage)\n999,a-01,Flat 2,50\n1,a-02,Flat 4,50';
 assert.deepEqual(parseUnitSharesCsv(unitCsv),[{code:'a-01',name:'Flat 2',percentage:'50'},{code:'a-02',name:'Flat 4',percentage:'50'}]);
 assert.throws(()=>parseUnitSharesCsv(unitCsv.replace('a-02','a-01')));
 assert.throws(()=>parseUnitSharesCsv(unitCsv.replace('50','101')));
});
test('Rounded shares reconcile exactly with stable unit IDs and expose adjustments',()=>{
 const rows=Array.from({length:14},(_,index)=>({unitId:index+1,percentage:'7.142860000000'}));
 const result=reconcileShares(rows);assert.equal(result.sourceTotal,'100.00004');assert.equal(result.adjusted,true);
 assert.equal(Object.values(result.percentages).reduce((total,value)=>total+Math.round(Number(value)*10000),0),1000000);
 assert.deepEqual(reconcileShares([...rows].reverse()),result);
 assert.equal(reconcileShares([{unitId:1,percentage:'100'}]).sourceTotal,'100');
 assert.equal(reconcileShares([{unitId:1,percentage:'100'}]).adjusted,false);
 assert.equal(reconcileShares([{unitId:1,percentage:'0'},{unitId:2,percentage:'100'}]).percentages[1],'0.0000');
 for(const bad of [[],[{unitId:1,percentage:'99'}],[{unitId:1,percentage:'0'}],[{unitId:1,percentage:'50'},{unitId:1,percentage:'50'}],[{unitId:0,percentage:'100'}]])assert.throws(()=>reconcileShares(bad));
});

test('saved numeric JSON percentages retain tiny decimals without exponent notation',()=>{
 assert.equal(sourcePercentageString(1e-12),'0.000000000001');
 assert.equal(sourcePercentageString(0),'0.000000000000');
 assert.equal(sourcePercentageString(null),null);
 assert.equal(sourcePercentageString('7.142860000000'),'7.142860000000');
 const result=reconcileShares([{unitId:1,percentage:sourcePercentageString(1e-12)},{unitId:2,percentage:'99.999999999999'}]);
 assert.equal(result.sourceTotal,'100');
});

test('rounding tolerance includes its exact boundaries and rejects genuine excess or shortage',()=>{
 for(const percentage of ['50.001','49.999']){
  const result=reconcileShares([{unitId:1,percentage:'50'},{unitId:2,percentage}]);
  assert.equal(Object.values(result.percentages).reduce((sum,value)=>sum+Math.round(Number(value)*10000),0),1000000);
  assert.equal(result.adjusted,true);
 }
 for(const percentage of ['50.001000000001','49.998999999999','50.01','49.99']){
  assert.throws(()=>reconcileShares([{unitId:1,percentage:'50'},{unitId:2,percentage}]),/rounding tolerance/);
 }
});

test('100.00004 percent import passes the strict annual-demand engine without losing or adding pennies',async()=>{
 const {apportionLeaseBudget,prepareFinancialDraft}=await import('../lib/financial-planning.ts');
 const rows=Array.from({length:14},(_,i)=>({unitId:i+1,percentage:'7.14286'}));
 const normalized=reconcileShares(rows);
 assert.equal(normalized.sourceTotal,'100.00004');
 const shares=rows.map(({unitId})=>({unitId,percentage:normalized.percentages[unitId]}));
 for(const totalPence of [1,1234567,999999999]){
  const allocations=apportionLeaseBudget(totalPence,shares);
  assert.equal(allocations.reduce((sum,row)=>sum+row.amountPence,0),totalPence);
 }
 const totalPence=1234567;
 const input={batchId:'import-budget:1:2027-01-01',blockId:1,kind:'Demand',preparedDate:'2026-12-01',issueDate:'2026-12-01',dueDate:'2027-01-01',issueMode:'Issue now, future due date',frequency:'Annual',yearStart:'2027-01-01',periodIndex:0,schedules:[{id:'import-budget:1:2027-01-01',name:'Synthetic annual budget',annualPence:totalPence,shares}]};
 const demand=prepareFinancialDraft(input);
 assert.equal(demand.length,14);
 assert.equal(demand.reduce((sum,row)=>sum+row.amountPence,0),totalPence);
 assert.throws(()=>reconcileShares(rows.slice(0,13)),/rounding tolerance/);
});
