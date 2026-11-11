/** Chromium CDP integration check. See docs/management-review.md for local-only setup. */
import assert from 'node:assert/strict';
import {fixture} from './fixtures/budget-xlsx.mjs';
const [target]=(await (await fetch('http://127.0.0.1:9222/json/list')).json());
const socket=new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
let id=0;const pending=new Map(),errors=[],requests=[];
socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(message.error):p.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);else if(message.method==='Network.requestWillBeSent')requests.push(message.params.request);});
function call(method,params={}){return new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});}
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function waitFor(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+expression);}
async function button(text){await waitFor(`[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&b.textContent.trim()===${JSON.stringify(text)})`);await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button'); b.click()})()`);await new Promise(r=>setTimeout(r,100));}
async function setLabel(label,value){await evaluate(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.getClientRects().length&&l.textContent.trim().startsWith(${JSON.stringify(label)}));if(!l)throw Error('Missing label '+${JSON.stringify(label)}); const el=l.querySelector('input,textarea,select');const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);await new Promise(r=>setTimeout(r,75));}

await call('Runtime.enable');await call('Network.enable');await call('Page.enable');await call('Page.navigate',{url:'http://127.0.0.1:3012/review'});await waitFor(`document.body?.innerText.includes('Import budget for')`);
async function upload(index,name,text){await evaluate(`(()=>{const inputs=document.querySelectorAll('input[type=file]'); const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(text)}],${JSON.stringify(name)},{type:'text/csv'}));inputs[${index}].files=dt.files;inputs[${index}].dispatchEvent(new Event('change',{bubbles:true}));})()`);await new Promise(r=>setTimeout(r,150));}
await upload(0,'budget.csv','Block Name,Example building\nFrom,2026-10-01\nTo,2027-09-30\nCategoryName,Budget 2025,Budget 2026\nInsurance,500,1000\nCleaning,500,2000\n,1000,3000');
await waitFor(`document.body.innerText.includes('Read budget.csv successfully in this browser.')`);
await setLabel('Annual budget column','2');await setLabel('Confirmed start date','2026-10-01');await waitFor(`document.body.innerText.includes('£3,000.00')`);
await upload(1,'shares.csv','Unit Code,Unit Name,Service Charge (Percentage)\nA,Flat 1,50\nB,Flat 2,30\nC,Flat 3,20');
await waitFor(`document.body.innerText.includes('Annual allocation preview')`);
await evaluate(`[...document.querySelectorAll('section[aria-label="Budget CSV import"] label')].find(l=>l.textContent.includes('I have checked the building')).querySelector('input').click()`);
await button('Use reviewed annual budget');await waitFor(`document.body.innerText.includes('No resident account has been charged.')`);
assert.equal(await evaluate(`document.querySelector('button.primary').disabled`),true);
await setLabel('Payment due date','2026-12-25');
await evaluate(`Array.from(document.querySelectorAll('label')).find(l=>l.textContent.includes('Confirm')&&l.querySelector('input[type=checkbox]'))?.querySelector('input').click()`);
assert.equal(requests.some(r=>r.method==='POST'||r.method==='PUT'),false);
await button('Clear import preview');assert.equal(await evaluate(`document.body.innerText.includes('Annual allocation preview')`),false);
await upload(0,'wrong.xlsx','bad');await waitFor(`document.body.innerText.includes('Could not read wrong.xlsx: Invalid XLSX ZIP container')`);
await button('Clear import preview');
const xlsx=Buffer.from(fixture()).toString('base64');
await evaluate(`(()=>{const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(xlsx)}),c=>c.charCodeAt(0))],'synthetic.xlsx'));const el=document.querySelector('input[type=file]');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await waitFor(`document.body.innerText.includes('Budget worksheet')`);
await waitFor(`document.body.innerText.includes('Read synthetic.xlsx successfully in this browser. Next: choose the budget worksheet below.')`);
assert.equal(await evaluate(`document.body.innerText.includes('Budget categories to include')`),false);
await setLabel('Budget worksheet','1');await waitFor(`document.body.innerText.includes('Choose a Summary worksheet')`);
await setLabel('Budget worksheet','0');await setLabel('Annual budget column','1');
await waitFor(`document.body.innerText.includes('£123.45')`);
assert.equal(await evaluate(`document.body.innerText.includes('No saved unit apportionments')`),true);
assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Use reviewed annual budget')`),false);
await upload(1,'shares.csv','Unit Code,Unit Name,Service Charge (Percentage)\nA,Flat 1,50\nB,Flat 2,30\nC,Flat 3,20');
await setLabel('Confirmed start date','2027-01-01');
await evaluate(`[...document.querySelectorAll('section[aria-label="Budget CSV import"] label')].find(l=>l.textContent.includes('I have checked the building')).querySelector('input').click()`);
await setLabel('Budget worksheet','1');
assert.equal(await evaluate(`document.body.innerText.includes('Annual allocation preview')`),false);
await setLabel('Budget worksheet','0');assert.equal(await evaluate(`document.body.innerText.includes('Budget categories to include')`),false);
await button('Clear import preview');
assert.equal(requests.some(r=>r.method==='POST'||r.method==='PUT'),false);
assert.equal(errors.length,0,JSON.stringify(errors));
console.log('Budget browser smoke passed: selected year, mappings, allocation, apply, repeated apply disabled, clear, invalid file, no writes.');socket.close();
