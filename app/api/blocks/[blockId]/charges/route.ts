import {randomUUID} from "node:crypto";
import {parse} from "csv-parse/sync";
import {NextRequest,NextResponse} from "next/server";
import {createClient} from "../../../../../lib/supabase/server";
const columns=["unit_number","entry_type","description","amount","entry_date","due_date","reference"];
export async function POST(request:NextRequest,{params}:{params:Promise<{blockId:string}>}){
 const blockId=Number((await params).blockId);
 if(!Number.isSafeInteger(blockId)||blockId<1)return NextResponse.json({error:"Invalid building."},{status:400});
 const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
 if(!user?.email)return NextResponse.json({error:"Sign in required."},{status:401});
 const {data:member}=await supabase.from("portal_members").select("role").eq("email",user.email.toLowerCase()).maybeSingle();
 if(!["owner","admin","manager"].includes(member?.role??""))return NextResponse.json({error:"Manager access required."},{status:403});
 const {data:block}=await supabase.from("blocks").select("id").eq("id",blockId).maybeSingle();
 if(!block)return NextResponse.json({error:"Building unavailable."},{status:404});
 let rows;
 try{
  const text=await request.text();if(new TextEncoder().encode(text).length>1000000)throw new Error("Upload must be under 1 MB.");
  if(request.headers.get("content-type")?.includes("text/csv")){
   const records=parse(text,{bom:true,trim:true,skip_empty_lines:true,max_record_size:20000}) as string[][];
   if(records[0]?.join(",")!==columns.join(","))throw new Error("Use the CSV template columns.");
   rows=records.slice(1).map(values=>{if(values.length!==columns.length)throw new Error("Each CSV row must have seven columns.");return Object.fromEntries(columns.map((c,i)=>[c,values[i]]));});
  }else rows=JSON.parse(text).rows;
  if(!Array.isArray(rows)||rows.length<1||rows.length>500)throw new Error("Provide 1 to 500 entries.");
  const seen=new Set<string>();
  rows=rows.map((row,index)=>{
   const v=Object.fromEntries(columns.map(c=>[c,typeof row?.[c]==="string"?row[c].trim():""]));
   const fail=(message:string)=>{throw new Error(`Row ${index+1}: ${message}`);};
   if(!v.unit_number||v.unit_number.length>80)fail("choose an existing unit.");
   if(!["Charge","Payment","Credit"].includes(v.entry_type))fail("type must be Charge, Payment or Credit.");
   if(!v.description||v.description.length>300)fail("enter a description up to 300 characters.");
   if(!/^\d+(\.\d{1,2})?$/.test(v.amount))fail("amount must be positive pounds, with up to two decimal places.");
   const amount_pence=Math.round(Number(v.amount)*100);
   if(!Number.isSafeInteger(amount_pence)||amount_pence<1||amount_pence>100000000)fail("amount is outside the supported range.");
   const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
   if(!validDate(v.entry_date))fail("entry date must be YYYY-MM-DD.");
   if(v.entry_type==="Charge"&&(!validDate(v.due_date)||v.due_date<v.entry_date))fail("charge due date must be on or after its entry date.");
   if(v.entry_type!=="Charge"&&v.due_date)fail("payments and credits must have no due date.");
   if(v.reference.length>100)fail("invoice / entry number must be up to 100 characters.");
   const request_id=v.reference?null:(typeof row.request_id==="string"?row.request_id:randomUUID());
   if(request_id&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request_id))fail("invalid save request.");
   const key=JSON.stringify([v.unit_number,v.entry_type,v.reference]);if(v.reference&&seen.has(key))fail("duplicate unit, type and reference in this upload.");seen.add(key);
   return {...v,amount_pence,request_id};
  });
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Invalid entries."},{status:400});}
 const {data,error}=await supabase.rpc("import_service_charges",{p_block_id:blockId,p_rows:rows});
 if(error)return NextResponse.json({error:"No entries were saved. Check unit numbers and charge details."},{status:400});
 const requestIds=rows.flatMap(row=>row.request_id?[row.request_id]:[]);
 let generated:string[]=[];
 if(requestIds.length){const result=await supabase.from("service_charge_entries").select("reference").eq("block_id",blockId).in("request_id",requestIds);generated=(result.data??[]).map(row=>row.reference);}
 return NextResponse.json({imported:data,generated});
}
