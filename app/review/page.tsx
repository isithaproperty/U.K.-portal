import {notFound} from "next/navigation";
import ManagementReview from "../ManagementReview";
import {canViewSyntheticReview} from "../../lib/review-access";
import type {Block,Unit,Resident,WorkOrder,Contractor} from "../types";
import type {ChargeEntry} from "../../lib/service-charges";
export const dynamic="force-dynamic";
export default function ReviewPage(){
 if(!canViewSyntheticReview(process.env.NODE_ENV,process.env.LONDON_REVIEW_MODE)) notFound();
 const blocks:Block[]=[{id:900001,name:"Example Court — synthetic",managementCompany:"Example Court Management Ltd",type:"Residential",address:"Example address, London",units:3,manager:"Demo manager",financialYearEnd:"31 December",myBlockManExportEnabled:false}];
 const units:Unit[]=[1,2,3].map(n=>({id:900010+n,blockId:900001,unitNumber:`Flat ${n}`,paymentReference:`DEMO${n}`}));
 const residents:Resident[]=units.map((unit,i)=>({id:900020+i,unitId:unit.id,blockId:unit.blockId,fullName:`Example leaseholder ${i+1}`,email:`leaseholder${i+1}@example.invalid`,phone:null}));
 const contractors:Contractor[]=[{id:900030,companyName:"Example Repairs Ltd",contactName:null,email:"repairs@example.invalid",phone:null,trade:"Repairs",companyRegistration:null,vatNumber:null,status:"Approved",expiryPauseReason:"",notes:"Synthetic fixture",createdAt:"2026-01-01",updatedAt:"2026-01-01"}];
 const wo:WorkOrder={id:900040,workOrderNumber:"DEMO-WO-1",blockId:900001,unitId:900011,residentId:900020,contractorId:900030,title:"Repair entrance door",description:"Synthetic job for review",category:"Repairs",priority:"Normal",status:"Complete",contractor:"Example Repairs Ltd",estimatedCost:200,actualCost:200,notes:"Synthetic fixture",addressSnapshot:"Example address",paymentStatus:"Approved",paymentApprovedBy:null,paymentApprovedAt:null,paidAt:null,createdBy:"demo@example.invalid",createdAt:"2026-10-01",updatedAt:"2026-10-01"};
 const workOrders:WorkOrder[]=[wo,{...wo,id:900041,workOrderNumber:"DEMO-WO-2",title:"Repair entrance door"}];
 const entries:ChargeEntry[]=[{id:900050,block_id:900001,unit_id:900011,entry_type:"Charge",description:"Synthetic annual charge",amount_pence:100000,entry_date:"2026-06-01",due_date:"2026-06-30",reference:"DEMO-INV-1"},{id:900051,block_id:900001,unit_id:900011,entry_type:"Payment",description:"Synthetic actual payment",amount_pence:25000,entry_date:"2026-10-15",due_date:null,reference:"DEMO-PAY-1"},{id:900052,block_id:900001,unit_id:900012,entry_type:"Charge",description:"Synthetic future due charge",amount_pence:50000,entry_date:"2026-11-01",due_date:"2026-12-25",reference:"DEMO-INV-2"}];
 return <main style={{maxWidth:1400,margin:"auto",padding:24}}><ManagementReview blocks={blocks} units={units} residents={residents} workOrders={workOrders} contractors={contractors} entries={entries} today="2026-11-02" synthetic/></main>;
}
