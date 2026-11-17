import test from 'node:test';import assert from 'node:assert/strict';import {validateSafetyDocument,SAFETY_DOCUMENT_LIMIT} from '../lib/building-safety-upload.ts';
test('existing bucket types and 10 MiB size limits are enforced without broadening formats',()=>{
 for(const [name,type] of [['synthetic.pdf','application/pdf'],['synthetic.jpg','image/jpeg'],['synthetic.png','image/png'],['synthetic.webp','image/webp']])assert.equal(validateSafetyDocument({name,type,size:SAFETY_DOCUMENT_LIMIT}).contentType,type);
 for(const file of [{name:'empty.pdf',type:'application/pdf',size:0},{name:'huge.pdf',type:'application/pdf',size:SAFETY_DOCUMENT_LIMIT+1},{name:'word.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:10},{name:'phone.heic',type:'image/heic',size:10},{name:'x.pdf',type:'text/html',size:10}])assert.throws(()=>validateSafetyDocument(file));
});
test('missing or generic browser MIME is inferred only for existing permitted file extensions',()=>{
 assert.equal(validateSafetyDocument({name:'SYNTHETIC.PDF',type:'',size:10}).contentType,'application/pdf');assert.equal(validateSafetyDocument({name:'SYNTHETIC.jpeg',type:'application/octet-stream',size:10}).contentType,'image/jpeg');assert.throws(()=>validateSafetyDocument({name:'unknown.data',type:'',size:10}));
});
