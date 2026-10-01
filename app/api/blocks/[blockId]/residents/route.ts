import { parse } from "csv-parse/sync";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../lib/supabase/server";

type ImportRow = { unit_number: string; resident_name: string; resident_email: string; phone: string;payment_reference:string };
const legacyHeaders = ["unit_number", "resident_name", "resident_email", "phone"];
const headers=[...legacyHeaders,"payment_reference"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest, context: { params: Promise<{ blockId: string }> }) {
  const { blockId: rawId } = await context.params;
  const blockId = Number(rawId);
  if (!Number.isSafeInteger(blockId) || blockId < 1) return NextResponse.json({ error: "Invalid block." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user?.email) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { data: membership } = await supabase.from("portal_members").select("role").eq("email", user.email.toLowerCase()).maybeSingle();
  if (!membership || !["owner", "admin", "manager"].includes(membership.role)) return NextResponse.json({ error: "Manager access required." }, { status: 403 });
  const { data: block } = await supabase.from("blocks").select("id").eq("id", blockId).maybeSingle();
  if (!block) return NextResponse.json({ error: "Block not found." }, { status: 404 });

  if (Number(request.headers.get("content-length")) > 1_000_000) return NextResponse.json({ error: "File exceeds 1 MB." }, { status: 413 });
  let rows: ImportRow[];
  try {
    if (request.headers.get("content-type")?.includes("text/csv")) {
      const body = await request.text();
      if (new TextEncoder().encode(body).length > 1_000_000) throw new Error("File exceeds 1 MB.");
      const records = parse(body, { bom: true, skip_empty_lines: true, trim: true, max_record_size: 20_000 }) as string[][];
      const columns=records[0]?.map(value=>value.toLowerCase());
      if(columns?.join(",")!==headers.join(",")&&columns?.join(",")!==legacyHeaders.join(","))throw new Error("Use the resident CSV template, including the optional payment_reference column.");
      rows = records.slice(1).map((values) => {
        if (values.length !== columns.length) throw new Error("Each row must match the template columns.");
        return Object.fromEntries(headers.map((key, index) => [key, values[index]??""])) as ImportRow;
      });
    } else {
      const body = await request.json();
      rows = body.rows;
    }
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) throw new Error("Provide 1 to 500 units or residents.");
    const references=new Map<string,string>();
    rows = rows.map((row, index) => {
      if (!row || typeof row !== "object") throw new Error(`Row ${index + 1}: invalid data.`);
      const values = Object.fromEntries(headers.map(key => [key, typeof row[key as keyof ImportRow] === "string" ? row[key as keyof ImportRow].trim() : ""])) as ImportRow;
      values.resident_email = values.resident_email.toLowerCase();
      if (!values.unit_number || values.unit_number.length > 80) throw new Error(`Row ${index + 1}: unit number is required (max 80 characters).`);
      if (values.resident_email && (!emailPattern.test(values.resident_email) || !values.resident_name)) throw new Error(`Row ${index + 1}: enter a valid resident email and name.`);
      if (!values.resident_email && (values.resident_name || values.phone)) throw new Error(`Row ${index + 1}: email is needed for resident details.`);
      if (values.resident_name.length > 200 || values.phone.length > 80) throw new Error(`Row ${index + 1}: resident details are too long.`);
      values.payment_reference=values.payment_reference.toUpperCase().replace(/\s/g,"");
      if(values.payment_reference&&(!/^[A-Z0-9][A-Z0-9/._-]*$/.test(values.payment_reference)||values.payment_reference.length>80))throw new Error(`Row ${index+1}: use a payment reference up to 80 letters, digits, slashes, dots or hyphens.`);
      const previous=references.get(values.unit_number);
      if(values.payment_reference&&previous&&previous!==values.payment_reference)throw new Error(`Row ${index+1}: joint residents must share the same unit payment reference.`);
      if(values.payment_reference)references.set(values.unit_number,values.payment_reference);
      return values;
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid import." }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("import_block_residents", { p_block_id: blockId, p_rows: rows });
  if (error) return NextResponse.json({ error: "Import failed. No rows were saved." }, { status: 400 });
  return NextResponse.json({ imported: data });
}
