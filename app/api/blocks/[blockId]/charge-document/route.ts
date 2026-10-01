import {NextRequest,NextResponse} from "next/server";
import {createClient} from "../../../../../lib/supabase/server";
import {documentFields} from "../../../../../lib/service-charge-document";
export async function POST(request:NextRequest,{params}:{params:Promise<{blockId:string}>}){
 const blockId=Number((await params).blockId);
 if(!Number.isSafeInteger(blockId)||blockId<1)return NextResponse.json({error:"Invalid development."},{status:400});
 const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
 if(!user?.email)return NextResponse.json({error:"Sign in required."},{status:401});
 const {data:member}=await supabase.from("portal_members").select("role").eq("email",user.email.toLowerCase()).maybeSingle();
 if(!["owner","admin","manager"].includes(member?.role??""))return NextResponse.json({error:"Manager access required."},{status:403});
 let settings;
 try{const text=await request.text();if(text.length>10000)throw new Error();const body=JSON.parse(text);settings=Object.fromEntries(documentFields.map(([key])=>{if(typeof body[key]!=="string"||body[key].length>1500)throw new Error();return [key,body[key].trim()];}));if(settings.sortCode&&!/^\d{2}-?\d{2}-?\d{2}$/.test(settings.sortCode))throw new Error();if(settings.accountNumber&&!/^\d{8}$/.test(settings.accountNumber))throw new Error();}catch{return NextResponse.json({error:"Check your document fields. Sort codes need six digits and UK account numbers need eight."},{status:400});}
 const {error}=await supabase.from("service_charge_document_settings").upsert({block_id:blockId,settings});
 return error?NextResponse.json({error:"Could not save settings for this development."},{status:403}):NextResponse.json({saved:true});
}
