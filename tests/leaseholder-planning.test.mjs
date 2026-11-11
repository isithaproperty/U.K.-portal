import test from "node:test";
import assert from "node:assert/strict";
import {parseContactEmails,contactRecipients,consultationReview,validateLeaseholderState,assertConsultationDispatchReady} from "../lib/leaseholder-planning.ts";
const owner={id:"1",blockId:1,unitId:1,name:"Owner",role:"Leaseholder",emails:["OWNER@example.com","joint@example.com"],communications:true,demands:true};
const tenant={...owner,id:"2",name:"Tenant",role:"Tenant",emails:["tenant@example.com"],demands:true};
test("multiple emails are normalised, deduplicated, and validated",()=>{
 assert.deepEqual(parseContactEmails(" FIRST@example.com,second@example.com;first@example.com\n"),["first@example.com","second@example.com"]);
 for(const input of ["","broken","x@y.com\r\nBcc:evil@example.com",Array.from({length:11},(_,i)=>`${i}@x.com`).join(",")])assert.throws(()=>parseContactEmails(input));
});
test("tenant preferences never grant demands or Section20 and blocks remain separated",()=>{
 const contacts=[owner,tenant,{...owner,id:"3",blockId:2,emails:["other@example.com"]}];
 assert.deepEqual(contactRecipients(contacts,1,"Demand").map(r=>r.email),["owner@example.com","joint@example.com"]);
 assert.deepEqual(contactRecipients(contacts,1,"Section 20").map(r=>r.email),["owner@example.com","joint@example.com"]);
 assert.equal(contactRecipients(contacts,1,"Block communication").length,3);
 assert.equal(contactRecipients([{...owner,demands:false}],1,"Demand").length,0);
 assert.equal(contactRecipients([{...owner,role:"Unclassified"}],1,"Demand").length,0);
 assert.throws(()=>contactRecipients([owner],1,"Unknown"));
});
test("recognised associations are included in Section20, not financial demands",()=>{
 const association={...owner,role:"Recognised association",unitId:null};
 assert.equal(contactRecipients([association],1,"Section 20").length,2);
 assert.equal(contactRecipients([association],1,"Demand").length,0);
 assert.equal(contactRecipients([owner,{...owner,id:"duplicate"}],1,"Demand").length,2);
});
const draft={id:"1",blockId:1,title:"Roof",route:"England route reviewed",applicability:"Qualifying works reviewed",stage:"Notice of intention",noticeDate:"2026-10-01",serviceDate:"2026-10-02",basisDate:"2026-10-05",basisReason:"Delivery basis reviewed",serviceMethod:"Post, evidence reference",confirmed:true,subject:"Draft",message:"Exact notice text",recipients:contactRecipients([owner],1,"Section 20")};
test("30-day alert is internal only and never advances stage",()=>{
 assert.deepEqual(consultationReview(draft,"2026-11-03"),{reviewDate:"2026-11-04",alert:false,status:"Awaiting internal review date",stage:"Notice of intention"});
 assert.equal(consultationReview(draft,"2026-11-04").alert,true);
 assert.equal(consultationReview(draft,"2026-11-20").stage,"Notice of intention");
 assert.equal(consultationReview({...draft,basisDate:"2026-12-20"},"2026-11-01").reviewDate,"2027-01-19");
});
test("review requires date, manual confirmation, route, service evidence and recipients",()=>{
 for(const patch of [{route:""},{applicability:""},{basisReason:""},{serviceMethod:""},{basisDate:"2026-02-30"},{basisDate:"2026-10-01"},{serviceDate:"2026-12-01"},{recipients:[]},{message:""}])assert.throws(()=>consultationReview({...draft,...patch},"2026-11-01"));
 assert.throws(()=>consultationReview(draft,"not a date"));
});
test("prepared notice drafts persist without implying service or scheduling an alert",()=>{
 const pending={...draft,confirmed:false,noticeDate:"",serviceDate:"",basisDate:"",serviceMethod:"",basisReason:""};
 assert.deepEqual(consultationReview(pending,"2026-11-01"),{reviewDate:null,alert:false,status:"Notice draft — service not confirmed",stage:"Notice of intention"});
 assert.equal(validateLeaseholderState({contacts:[normalOwner],consultations:[pending]},1,[1],"2026-11-01").consultations[0].confirmed,false);
});
const normalOwner={...owner,emails:["owner@example.com","joint@example.com"]};
test("persistence validator accepts a scoped contact and consultation snapshot",()=>{
 const state=validateLeaseholderState({contacts:[normalOwner],consultations:[draft]},1,[1],"2026-11-01");
 assert.equal(state.contacts.length,1);assert.equal(state.consultations.length,1);
 assert.deepEqual(validateLeaseholderState({contacts:[],consultations:[]},1,[],"2026-11-01"),{contacts:[],consultations:[]});
});
test("persistence rejects cross-block records, foreign units, unclassified roles and tenant demands",()=>{
 for(const patch of [{blockId:2},{unitId:99},{role:"Unclassified"},{role:"Tenant",demands:true},{emails:["OWNER@example.com"]},{communications:"true"}])assert.throws(()=>validateLeaseholderState({contacts:[{...normalOwner,...patch}],consultations:[]},1,[1],"2026-11-01"));
 assert.throws(()=>validateLeaseholderState({contacts:[normalOwner,normalOwner],consultations:[]},1,[1],"2026-11-01"));
});
test("saved consultation snapshots cannot add tenants, foreign units or absent contacts",()=>{
 for(const patch of [{blockId:2},{stage:"Complete"},{recipients:[{...draft.recipients[0],unitId:99}]},{recipients:[{...draft.recipients[0],contactId:"unknown"}]},{recipients:[draft.recipients[0],draft.recipients[0]]}])assert.throws(()=>validateLeaseholderState({contacts:[normalOwner],consultations:[{...draft,...patch}]},1,[1],"2026-11-01"));
 assert.throws(()=>validateLeaseholderState({contacts:[{...normalOwner,role:"Tenant",demands:false}],consultations:[draft]},1,[1],"2026-11-01"));
});
const approvedCoverage={reviewed:true,requiredUnitIds:[1],postalRecipients:[],associationReview:"No recognised association, register checked",coverageReference:"Leaseholder register reviewed",electronicServiceConfirmed:true,servicePermissionReference:"Consents checked",legalTemplateApproved:true,legalApprovalReference:"Solicitor approved exact wording v1"};
test("Section20 queue requires explicit legal approval, electronic permission and full recipient coverage",()=>{
 const pending={...draft,confirmed:false,coverage:approvedCoverage};
 assert.equal(assertConsultationDispatchReady(pending,[normalOwner],1).emailRecipients.length,2);
 assert.throws(()=>assertConsultationDispatchReady({...pending,confirmed:true},[normalOwner],1));
 assert.throws(()=>assertConsultationDispatchReady({...pending,coverage:undefined},[normalOwner],1));
 for(const patch of [{reviewed:false},{requiredUnitIds:[]},{requiredUnitIds:[1,2]},{legalTemplateApproved:false},{legalApprovalReference:""},{electronicServiceConfirmed:false},{servicePermissionReference:""},{associationReview:""}])assert.throws(()=>assertConsultationDispatchReady({...pending,coverage:{...approvedCoverage,...patch}},[normalOwner],1));
});
test("Section20 accepts recorded postal coverage without implying that email completed postal service",()=>{
 const postal={unitId:2,name:"Postal owner",address:"Example postal address",serviceMethod:"Reviewed postal service method"};
 const pending={...draft,confirmed:false,coverage:{...approvedCoverage,requiredUnitIds:[1,2],postalRecipients:[postal]}};
 assert.deepEqual(assertConsultationDispatchReady(pending,[normalOwner],1).postalRecipients,[postal]);
 const saved=validateLeaseholderState({contacts:[normalOwner],consultations:[pending]},1,[1,2],"2026-11-01");assert.equal(saved.consultations[0].coverage.postalRecipients.length,1);
 assert.throws(()=>validateLeaseholderState({contacts:[normalOwner],consultations:[pending]},1,[1],"2026-11-01"));
});
test("Section20 snapshots must be reviewed again when eligible contacts change",()=>{
 const pending={...draft,confirmed:false,coverage:approvedCoverage};
 assert.throws(()=>assertConsultationDispatchReady(pending,[normalOwner,{...normalOwner,id:"new",emails:["additional@example.com"]}],1));
 assert.throws(()=>assertConsultationDispatchReady(pending,[{...normalOwner,role:"Tenant",demands:false}],1));
 assert.throws(()=>assertConsultationDispatchReady(pending,[normalOwner],2));
});
