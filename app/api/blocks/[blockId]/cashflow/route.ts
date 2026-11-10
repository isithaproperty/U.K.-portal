import {NextRequest,NextResponse} from "next/server";
import {createClient} from "../../../../../lib/supabase/server";
import {canManageReviewBlock} from "../../../../../lib/management-review";
import {cashflowDateRange,inspectCashflowCsv,stageCashflowCsv,type BuildingCashflowRow} from "../../../../../lib/building-cashflow";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
class AccessError extends Error {constructor(message:string,readonly status:number){super(message);}}
async function access(raw:string){
 const blockId=Number(raw);if(!Number.isSafeInteger(blockId)||blockId<1)throw new AccessError("Invalid building.",400);
 const supabase=await createClient();const {data:{user},error:authError}=await supabase.auth.getUser();
 if(authError||!user?.email)throw new AccessError("Sign in required.",401);
 const {data:member,error:memberError}=await supabase.from("portal_members").select("role,portfolio_manager").eq("email",user.email.toLowerCase()).maybeSingle();
 if(memberError||!member||!["owner","admin","manager"].includes(member.role))throw new AccessError("Manager access required.",403);
 const {data:block,error:blockError}=await supabase.from("blocks").select("id,manager").eq("id",blockId).maybeSingle();
 if(blockError||!block)throw new AccessError("Building unavailable.",404);
 if(!canManageReviewBlock(member,block.manager))throw new AccessError("Building is outside your management portfolio.",403);
 return {supabase,blockId};
}
export async function GET(request:NextRequest,{params}:{params:Promise<{blockId:string}>}){
 try{
  const {supabase,blockId}=await access((await params).blockId);
  const {start,end}=cashflowDateRange(request.nextUrl.searchParams.get("start"),request.nextUrl.searchParams.get("end"));
  const rows:BuildingCashflowRow[]=[];let count=0;
  for(let offset=0;offset<10000;offset+=1000){
   let query=supabase.from("building_cashflow_rows").select("id,block_id,transaction_date,amount_pence,bank_reference,description,transaction_id,source_file,status,imported_at",{count:"exact"}).eq("block_id",blockId);
   if(start)query=query.gte("transaction_date",start);if(end)query=query.lte("transaction_date",end);
   const result=await query.order("id",{ascending:true}).range(offset,offset+999);
   if(result.error||result.count===null)return reply({error:"Building cashflow storage is unavailable. Check the reviewed migration before importing statements."},503);
   count=result.count;rows.push(...(result.data??[]) as BuildingCashflowRow[]);
   if(rows.length>=count||(result.data??[]).length<1000)break;
  }
  return reply({rows,count,truncated:rows.length<count});
 }catch(error){return reply({error:error instanceof Error?error.message:"Cashflow unavailable."},error instanceof AccessError?error.status:400);}
}
export async function POST(request:NextRequest,{params}:{params:Promise<{blockId:string}>}){
 try{
  const {supabase,blockId}=await access((await params).blockId);
  if(!request.headers.get("content-type")?.includes("multipart/form-data"))return reply({error:"Upload a CSV statement with its column mapping. This endpoint never posts payments."},400);
  if(Number(request.headers.get("content-length"))>2_100_000)throw new Error("Statement must be under 2 MB.");
  const form=await request.formData(),file=form.get("file"),action=form.get("action");
  if(!(file instanceof File)||!file.name.toLowerCase().endsWith(".csv")||file.size>2_000_000)throw new Error("Upload a CSV bank statement under 2 MB.");
  const text=await file.text();
  if(action==="inspect"){const {headers,sample}=inspectCashflowCsv(text);return reply({headers,sample});}
  if(action!=="import")throw new Error("Choose inspect or import. No ledger posting is supported here.");
  let mapping:unknown;try{mapping=JSON.parse(String(form.get("mapping")));}catch{throw new Error("Provide valid column mapping.");}
  const {rows,skipped}=stageCashflowCsv(text,mapping,file.name);
  if(!rows.length)return reply({added:0,duplicates:0,skipped});
  const {data,error}=await supabase.rpc("stage_building_cashflow",{p_block_id:blockId,p_rows:rows});
  if(error)return reply({error:"Cashflow import was not confirmed. Check the migration and transaction details, then reload before retrying. Retrying the same statement uses the same transaction fingerprints."},503);
  return reply({...data,skipped});
 }catch(error){return reply({error:error instanceof Error?error.message:"Could not process bank statement."},error instanceof AccessError?error.status:400);}
}
