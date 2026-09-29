import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";
import Portal from "./Portal";
import type { Block, Unit, Resident } from "./types";

export const dynamic = "force-dynamic";
export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");
  const email = user.email.toLowerCase();
  const { data: membership } = await supabase.from("portal_members").select("role").eq("email", email).maybeSingle();
  const isManager = membership?.role === "owner" || membership?.role === "manager";
  const [blockResult, unitResult, residentResult] = await Promise.all([
    supabase.from("blocks").select("id,source_row,name,management_company,type,address,units,manager,financial_year_end,myblockman_export_enabled").order("name"),
    supabase.from("units").select("id,block_id,unit_number").order("unit_number"),
    supabase.from("residents").select("id,unit_id,block_id,full_name,email,phone"),
  ]);
  if (blockResult.error || unitResult.error || residentResult.error) return <main className="login-page"><div className="login-card"><h1>Portfolio unavailable</h1><p>Please try again shortly.</p></div></main>;
  if (!isManager && !residentResult.data?.some(row => row.email === email)) return <main className="login-page"><div className="login-card"><h1>Access pending</h1><p>This email has not been assigned to a unit. Ask the managing team for access.</p></div></main>;
  const data = blockResult.data;
  const blocks: Block[] = (data ?? []).map(row => ({
    id: row.id, name: row.name, managementCompany: row.management_company,
    type: row.type, address: row.address, units: row.units, manager: row.manager,
    financialYearEnd: row.financial_year_end, myBlockManExportEnabled: row.myblockman_export_enabled,
  }));
  const units: Unit[] = (unitResult.data ?? []).map(row => ({ id: row.id, blockId: row.block_id, unitNumber: row.unit_number }));
  const residents: Resident[] = (residentResult.data ?? []).map(row => ({ id: row.id, unitId: row.unit_id, blockId: row.block_id, fullName: row.full_name, email: row.email, phone: row.phone }));
  return <Portal blocks={blocks} units={units} residents={residents} isManager={isManager} viewerEmail={email} />;
}
