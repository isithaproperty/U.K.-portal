import test from 'node:test';
import assert from 'node:assert/strict';
import {residentCsvRows,resolveResidentUnits,validSourcePercentage} from '../lib/resident-import.ts';
const row=(overrides={})=>({unit_number:'Flat 1',unit_code:'',resident_name:'',resident_email:'',phone:'',payment_reference:'',service_charge_percentage:'',...overrides});
test('old resident templates and optional share aliases remain compatible',()=>{
 for(const headers of [['unit_number','resident_name','resident_email','phone'],['unit_number','resident_name','resident_email','phone','payment_reference']])assert.equal(residentCsvRows([headers,headers.map((_,i)=>i===0?'Flat 1':'')])[0].service_charge_percentage,'');
 assert.equal(residentCsvRows([['unit_number','service_charge_percentage'],['Flat 1','0']])[0].service_charge_percentage,'0');
 const parsed=residentCsvRows([['ID','Unit Code','Unit Name','Unit Description','Service Charge (Percentage)'],['999','1066-01','Flat 1','Apartment','7.142860000000']]);
 assert.equal(parsed[0].unit_number,'Flat 1');assert.equal(parsed[0].unit_code,'1066-01');assert.equal(parsed[0].service_charge_percentage,'7.142860000000');assert.equal(parsed[0].id,undefined);
 assert.throws(()=>residentCsvRows([['ID','Unit Code','Unit Name','Unit Description','Service Charge (Percentage)'],['226','1066-4','Apartment','7.142860000000']]));
 assert.throws(()=>residentCsvRows([['unit_number','Service Charge (Percentage)','service_charge_percentage'],['Flat 1','50','50']]));
});
test('unit identity is scoped to supplied building labels, never numbers inferred from names or IDs',()=>{
 const existing=[{unit_number:'Flat 1'},{unit_number:'1'},{unit_number:'1066-02'}];
 assert.equal(resolveResidentUnits([row({unit_number:'flat 1'})],existing)[0].unit_number,'Flat 1');
 assert.equal(resolveResidentUnits([row({unit_number:'Flat 2',unit_code:'1066-02'})],existing)[0].unit_number,'1066-02');
 assert.throws(()=>resolveResidentUnits([row({unit_code:'1'})],existing));
 assert.throws(()=>resolveResidentUnits([row()],[{unit_number:'Flat 1'},{unit_number:'flat 1'}]));
 assert.equal(resolveResidentUnits([row({unit_number:'Flat1'})],existing)[0].unit_number,'Flat1');
});
test('joint residents share one value; blanks preserve; conflicts and malformed percentages rejected',()=>{
 const rows=resolveResidentUnits([row({service_charge_percentage:'50'}),row({service_charge_percentage:'50.000'}),row()],[]);
 assert.deepEqual(rows.map(r=>r.service_charge_percentage),['50','50.000','']);
 assert.throws(()=>resolveResidentUnits([row({service_charge_percentage:'50'}),row({unit_number:'flat 1',service_charge_percentage:'40'})],[]));
 assert.throws(()=>resolveResidentUnits([row({unit_code:'same'}),row({unit_number:'Flat 2',unit_code:'same'})],[]));
 for(const value of ['-1','100.000000000001','NaN','1e2','50%','1.1234567890123','=50'])assert.equal(validSourcePercentage(value),false);
 for(const value of ['0','100','7.142860000000'])assert.equal(validSourcePercentage(value),true);
});

test('new case-variant joint-resident labels resolve to one canonical unit for the legacy RPC too',()=>{
 const rows=resolveResidentUnits([row(),row({unit_number:'flat 1'})],[]);
 assert.deepEqual(rows.map(r=>r.unit_number),['Flat 1','Flat 1']);
});
