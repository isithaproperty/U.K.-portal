import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";
import Portal from "./Portal";
import type { Block } from "./types";

export const dynamic = "force-dynamic";
export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");
  const { data: membership, error: membershipError } = await supabase.from("portal_members").select("role").eq("email", user.email.toLowerCase()).maybeSingle();
  if (membershipError || !membership) return <main className="login-page"><div className="login-card"><h1>Access pending</h1><p>This email has not been added to the portal. Ask the portal owner for access.</p></div></main>;
  const { data, error } = await supabase.from("blocks").select("source_row,name,management_company,type,address,units,manager,financial_year_end,myblockman_export_enabled").order("name");
  if (error) return <main className="login-page"><div className="login-card"><h1>Block list unavailable</h1><p>Please try again shortly.</p></div></main>;
  const blocks: Block[] = (data ?? []).map(row => ({
    id: row.source_row, name: row.name, managementCompany: row.management_company,
    type: row.type, address: row.address, units: row.units, manager: row.manager,
    financialYearEnd: row.financial_year_end, myBlockManExportEnabled: row.myblockman_export_enabled,
  }));
  return <Portal blocks={blocks} />;
}
