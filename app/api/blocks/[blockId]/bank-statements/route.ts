import {NextRequest,NextResponse} from "next/server";
import {createClient} from "../../../../../lib/supabase/server";
import {inspectCashflowCsv,stageCashflowCsv} from "../../../../../lib/building-cashflow";
async function access(raw:string){const blockId=Number(raw);if(!Number.isSafeInteger(blockId)||blockId<1)throw new Error("Invalid block.");const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user?.email)throw new Error("Sign in required.");const {data:member}=await supabase.from("portal_members").select("role").eq("email",user.email.toLowerCase()).maybeSingle();if(!["owner","admin","manager"].includes(member?.role??""))throw new Error("Manager access required.");const {data:block}=await supabase.from("blocks").select("id").eq("id",blockId).maybeSingle();if(!block)throw new Error("Block unavailable.");return {supabase,blockId};}
export async function GET(request:NextRequest,{params}:{params:Promise<{blockId:string}>}){try{const {supabase,blockId}=await access((await params).blockId);const status=request.nextUrl.searchParams.get("status")??"Pending";if(!["Pending","Posted","Ignored"].includes(status))throw new Error("Invalid status.");const {data,error,count}=await supabase.from("bank_statement_rows").select("id,block_id,transaction_date,amount_pence,bank_reference,description,transaction_id,source_file,status,unit_id,payment_entry_id,imported_at",{count:"exact"}).eq("block_id",blockId).eq("status",status).order("id",{ascending:status==="Pending"}).limit(1000);if(error)throw new Error("Could not load statement rows.");return NextResponse.json({rows:data,count});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Unavailable."},{status:400});}}
export async function POST(request:NextRequest,{params}:{params:Promise<{blockId:string}>}){
 try{const {supabase,blockId}=await access((await params).blockId);
 if(request.headers.get("content-type")?.includes("application/json")){
  const text=await request.text();if(text.length>100000)throw new Error("Request too large.");const body=JSON.parse(text);
  if(body.action==="post"){if(!Array.isArray(body.assignments)||body.assignments.length<1||body.assignments.length>1000||body.assignments.some((a:{id:number;unit_id:number})=>!Number.isSafeInteger(a.id)||!Number.isSafeInteger(a.unit_id)))throw new Error("Select valid payments and units.");const {data,error}=await supabase.rpc("post_bank_payments",{p_block_id:blockId,p_assignments:body.assignments});if(error)throw new Error("Payments were not posted. Check they are pending and assigned to this block.");return NextResponse.json({posted:data});}
  if(body.action==="ignore"){if(!Array.isArray(body.ids)||body.ids.length<1||body.ids.length>1000||body.ids.some((id:number)=>!Number.isSafeInteger(id)))throw new Error("Select valid rows.");const {data,error}=await supabase.from("bank_statement_rows").update({status:"Ignored"}).eq("block_id",blockId).eq("status","Pending").in("id",body.ids).select("id");if(error)throw new Error("Could not ignore these rows.");return NextResponse.json({ignored:data?.length??0});}
  throw new Error("Invalid action.");
 }
 if(Number(request.headers.get("content-length"))>2100000)throw new Error("Statement must be under 2 MB.");const form=await request.formData();const file=form.get("file");if(!(file instanceof File)||!file.name.toLowerCase().endsWith(".csv")||file.size>2000000)throw new Error("Upload a CSV bank statement under 2 MB.");const csv=await file.text();const {headers,sample}=inspectCashflowCsv(csv);
 if(form.get("action")==="inspect")return NextResponse.json({headers,sample});
 const {rows,skipped}=stageCashflowCsv(csv,JSON.parse(String(form.get("mapping"))),file.name);
 if(!rows.length)return NextResponse.json({added:0,duplicates:0,skipped,outgoing:0});
 const {data,error}=await supabase.rpc("stage_block_statement",{p_block_id:blockId,p_rows:rows});
 if(error)throw new Error("Full statement was not imported. Check details and that the reviewed whole-block reconciliation migration is installed.");
 return NextResponse.json({...data,skipped,outgoing:rows.filter(row=>row.amount_pence<0).length});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Could not process statement."},{status:400});}
}
