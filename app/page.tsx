import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";
import Portal from "./Portal";
import type { Block, Unit, Resident, WorkOrder, Contractor, ContractorDocument } from "./types";

export const dynamic = "force-dynamic";
export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");
  const email = user.email.toLowerCase();
  const { data: membership } = await supabase.from("portal_members").select("role").eq("email", email).maybeSingle();
  const isManager = membership?.role === "owner" || membership?.role === "manager";
  const [blockResult, unitResult, residentResult, workOrderResult, contractorResult, contractorDocumentResult] = await Promise.all([
    supabase.from("blocks").select("id,source_row,name,management_company,type,address,units,manager,financial_year_end,myblockman_export_enabled").order("name"),
    supabase.from("units").select("id,block_id,unit_number").order("unit_number"),
    supabase.from("residents").select("id,unit_id,block_id,full_name,email,phone"),
    supabase.from("work_orders").select("id,work_order_number,block_id,unit_id,resident_id,contractor_id,title,description,category,priority,status,contractor,estimated_cost,actual_cost,notes,address_snapshot,created_by,created_at,updated_at").order("created_at",{ascending:false}),
    supabase.from("contractors").select("id,company_name,contact_name,email,phone,trade,company_registration,vat_number,status,notes,created_at,updated_at").order("company_name"),
    supabase.from("contractor_documents").select("id,contractor_id,document_type,file_name,storage_path,mime_type,file_size,expiry_date,notes,uploaded_at").order("uploaded_at",{ascending:false}),
  ]);
  if (blockResult.error || unitResult.error || residentResult.error || workOrderResult.error || contractorResult.error || contractorDocumentResult.error) return <main className="login-page"><div className="login-card"><h1>Portfolio unavailable</h1><p>Please try again shortly.</p></div></main>;
  if (!isManager && !residentResult.data?.some(row => row.email === email)) return <main className="login-page"><div className="login-card"><h1>Access pending</h1><p>This email has not been assigned to a unit. Ask the managing team for access.</p></div></main>;
  const data = blockResult.data;
  const blocks: Block[] = (data ?? []).map(row => ({
    id: row.id, name: row.name, managementCompany: row.management_company,
    type: row.type, address: row.address, units: row.units, manager: row.manager,
    financialYearEnd: row.financial_year_end, myBlockManExportEnabled: row.myblockman_export_enabled,
  }));
  const units: Unit[] = (unitResult.data ?? []).map(row => ({ id: row.id, blockId: row.block_id, unitNumber: row.unit_number }));
  const residents: Resident[] = (residentResult.data ?? []).map(row => ({ id: row.id, unitId: row.unit_id, blockId: row.block_id, fullName: row.full_name, email: row.email, phone: row.phone }));
  const workOrders: WorkOrder[] = (workOrderResult.data ?? []).map(row => ({ id:row.id, workOrderNumber:row.work_order_number, blockId:row.block_id, unitId:row.unit_id, residentId:row.resident_id, contractorId:row.contractor_id, title:row.title, description:row.description, category:row.category, priority:row.priority, status:row.status, contractor:row.contractor, estimatedCost:row.estimated_cost===null?null:Number(row.estimated_cost), actualCost:row.actual_cost===null?null:Number(row.actual_cost), notes:row.notes, addressSnapshot:row.address_snapshot, createdBy:row.created_by, createdAt:row.created_at, updatedAt:row.updated_at }));
  const contractors: Contractor[] = (contractorResult.data ?? []).map(row => ({id:row.id,companyName:row.company_name,contactName:row.contact_name,email:row.email,phone:row.phone,trade:row.trade,companyRegistration:row.company_registration,vatNumber:row.vat_number,status:row.status,notes:row.notes,createdAt:row.created_at,updatedAt:row.updated_at}));
  const contractorDocuments: ContractorDocument[] = (contractorDocumentResult.data ?? []).map(row => ({id:row.id,contractorId:row.contractor_id,documentType:row.document_type,fileName:row.file_name,storagePath:row.storage_path,mimeType:row.mime_type,fileSize:row.file_size,expiryDate:row.expiry_date,notes:row.notes,uploadedAt:row.uploaded_at}));
  return <Portal blocks={blocks} units={units} residents={residents} workOrders={workOrders} contractors={contractors} contractorDocuments={contractorDocuments} isManager={isManager} viewerEmail={email} />;
}
