import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {uploadStaffDocumentBatch,StaffDocumentBatchError,STAFF_DOCUMENT_BUCKET,MAX_STAFF_INVOICE_FILES} from '../lib/staff-work-order-documents.ts';
const pdf=(name='invoice.pdf')=>new File(['%PDF-1.4'],name,{type:'application/pdf'});
function transport({failUpload=0,failRecord=0}={}){
 const uploads=[],records=[];
 const client={auth:{getUser:async()=>({data:{user:{email:'manager@example.invalid'}},error:null})},storage:{from(bucket){assert.equal(bucket,STAFF_DOCUMENT_BUCKET);return {async upload(path,file,options){uploads.push({path,file,options});return {error:uploads.length===failUpload?new Error('Synthetic upload failure'):null};}};}},from(table){assert.equal(table,'staff_work_order_documents');return {async insert(row){records.push(row);return {error:records.length===failRecord?new Error('Synthetic record failure'):null};}};}};
 return {client,uploads,records};
}
const args=t=>({client:t.client,workOrderId:101,contractorId:9,isOngoing:true,kind:'invoice'});
test('monthly files append independently with unique paths and preserve duplicate original filenames',async()=>{
 const t=transport();assert.equal(await uploadStaffDocumentBatch({...args(t),files:[pdf(),pdf(),pdf('March.pdf')]}),3);
 assert.equal(await uploadStaffDocumentBatch({...args(t),files:[pdf('April.pdf')]}),1);
 assert.equal(t.records.length,4);assert.equal(new Set(t.records.map(r=>r.storage_path)).size,4);
 for(const [index,row] of t.records.entries()){assert.equal(row.work_order_id,101);assert.equal(row.contractor_id,9);assert.equal(row.document_type,'invoice');assert.match(row.storage_path,/^101\/[0-9a-f-]{36}\/invoice\.pdf$/);assert.deepEqual(t.uploads[index].options,{contentType:'application/pdf',upsert:false});assert.deepEqual(Object.keys(row).sort(),['contractor_id','document_type','id','original_name','storage_path','work_order_id']);}
 assert.deepEqual(t.records.map(r=>r.original_name),['invoice.pdf','invoice.pdf','March.pdf','April.pdf']);
});
test('preflights every selected file and batch limits before any storage write',async()=>{
 const t=transport();for(const patch of [{files:[pdf(),new File(['html'],'bad.pdf',{type:'application/pdf'})]},{files:Array.from({length:13},()=>pdf())},{files:[]},{files:[pdf(),pdf()],isOngoing:false},{files:[pdf(),pdf()],kind:'job-card'},{files:[pdf()],contractorId:null}])await assert.rejects(uploadStaffDocumentBatch({...args(t),...patch}));
 assert.equal(t.uploads.length,0);assert.equal(await uploadStaffDocumentBatch({...args(t),files:Array.from({length:MAX_STAFF_INVOICE_FILES},()=>pdf())}),12);
});
test('partial storage or metadata failure stops the batch, preserves confirmed history and marks uncertainty',async()=>{
 for(const failure of [{failUpload:2},{failRecord:2}]){
  const t=transport(failure);await assert.rejects(uploadStaffDocumentBatch({...args(t),files:[pdf('Jan.pdf'),pdf('Feb.pdf'),pdf('March.pdf')]}),error=>{assert.ok(error instanceof StaffDocumentBatchError);assert.equal(error.savedCount,1);return true;});
  assert.equal(t.uploads.length,2);assert.equal(t.records[0].original_name,'Jan.pdf');assert.ok(!t.records.some(r=>r.original_name==='March.pdf'));
 }
});
function ui(props={}){
 const source=readFileSync(new URL('../app/StaffWorkOrderDocuments.tsx',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace('export default function','function').replace(/^export /gm,'');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
 let cursor=0,tree,refreshes=0;const state=[],refs=[],t=transport(props.failure);
 const useState=initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];};
 const useRef=initial=>{const i=cursor++;return refs[i]??={current:initial};};
 const React={createElement:(tag,props,...children)=>({tag,props:props??{},children:children.flat(Infinity)})};
 const component=new Function('React','useState','useRef','useRouter','createClient','uploadStaffDocumentBatch','StaffDocumentBatchError','STAFF_DOCUMENT_BUCKET','MAX_STAFF_INVOICE_FILES',`${js};return StaffWorkOrderDocuments;`)(React,useState,useRef,()=>({refresh(){refreshes++;}}),()=>t.client,uploadStaffDocumentBatch,StaffDocumentBatchError,STAFF_DOCUMENT_BUCKET,MAX_STAFF_INVOICE_FILES);
 function render(){cursor=0;tree=component({workOrderId:101,workOrderNumber:'WO-101',contractorId:9,contractorName:'Synthetic contractor',manager:true,canUpload:true,documents:[],loadError:false,isOngoing:true,...props});}
 function nodes(){const result=[];function walk(n){if(n&&typeof n==='object'){result.push(n);n.children.forEach(walk);}}walk(tree);return result;}
 render();return {render,nodes,...t,get refreshes(){return refreshes;}};
}
test('ongoing upload UI permits multiple invoices and guards double submission',async()=>{
 const h=ui();let input=h.nodes().find(n=>n.tag==='input'&&n.props.type==='file');assert.equal(input.props.multiple,true);input.props.onChange({target:{files:[pdf(),pdf()]}});h.render();
 const form=h.nodes().find(n=>n.tag==='form'),event={preventDefault(){}};await Promise.all([form.props.onSubmit(event),form.props.onSubmit(event)]);h.render();assert.equal(h.records.length,2);assert.equal(h.refreshes,1);
 h.nodes().find(n=>n.tag==='select').props.onChange({target:{value:'job-card'}});h.render();assert.equal(h.nodes().find(n=>n.tag==='input').props.multiple,false);
});
test('UI blocks uncertain batches, unloaded history, non-manager and ineligible upload states',async()=>{
 const h=ui({failure:{failRecord:2}});h.nodes().find(n=>n.tag==='input').props.onChange({target:{files:[pdf(),pdf(),pdf()]}});h.render();await h.nodes().find(n=>n.tag==='form').props.onSubmit({preventDefault(){}});h.render();assert.equal(h.nodes().find(n=>n.tag==='input').props.disabled,true);assert.equal(h.uploads.length,2);await h.nodes().find(n=>n.tag==='form').props.onSubmit({preventDefault(){}});assert.equal(h.uploads.length,2);
 for(const props of [{loadError:true},{canUpload:false}]){const x=ui(props);x.nodes().find(n=>n.tag==='input').props.onChange({target:{files:[pdf()]}});x.render();await x.nodes().find(n=>n.tag==='form').props.onSubmit({preventDefault(){}});assert.equal(x.uploads.length,0);}
 assert.equal(ui({manager:false}).nodes().some(n=>n.tag==='form'),false);
});
test('work-order tabs hide Actual Amount controls and ongoing links target monthly uploads',()=>{
 for(const file of ['WorkOrderRegister','BlockDashboard']){const source=readFileSync(new URL(`../app/${file}.tsx`,import.meta.url),'utf8');assert.doesNotMatch(source,/<th>Actual cost|<label>Actual cost|Actual £/);assert.match(source,/#staff-documents/);assert.match(source,/Upload monthly invoices/);}
 const page=readFileSync(new URL('../app/work-orders/[id]/page.tsx',import.meta.url),'utf8');assert.match(page,/isOngoing={wo.is_ongoing===true}/);
});
