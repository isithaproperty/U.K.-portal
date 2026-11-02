import {NextRequest,NextResponse} from "next/server";
import {createClient} from "../../../../../lib/supabase/server";
import {canManageReviewBlock} from "../../../../../lib/management-review";
import {financialDraftToLedgerRows,validateFinancialState} from "../../../../../lib/financial-planning";
import {generateFinancialDocuments} from "../../../../../lib/management-documents";
import {londonDate} from "../../../../../lib/service-charges";
import type {FinancialDocumentInput,FinancialDocumentSettings} from "../../../../../lib/management-documents";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
/** Read-only document generation; no ledger mutation, storage writes or email dispatch. */
export async function POST(request:NextRequest,{params}:{params:Promise<{blockId:string}>}){
 const blockId=Number((await params).blockId);
 if(!Number.isSafeInteger(blockId)||blockId<1)return reply({error:"Invalid block."},400);
 const client=await createClient();const {data:{user},error:authError}=await client.auth.getUser();
 if(authError||!user?.email)return reply({error:"Sign in required."},401);
 const {data:member,error:memberError}=await client.from("portal_members").select("role,portfolio_manager").eq("email",user.email.toLowerCase()).maybeSingle();
 if(memberError||!member||!["owner","admin","manager"].includes(member.role))return reply({error:"Manager access required."},403);
 const {data:block,error:blockError}=await client.from("blocks").select("id,name,address,management_company,manager").eq("id",blockId).maybeSingle();
 if(blockError||!block)return reply({error:"Block unavailable."},404);
 if(!canManageReviewBlock(member,block.manager))return reply({error:"Block is outside your management portfolio."},403);
 let body:{revision:number;batchId:string;mode:"Draft"|"Issue";documentReview?:FinancialDocumentInput["documentReview"]};
 try{const raw=await request.text();if(new TextEncoder().encode(raw).length>15000)throw new Error("Document request is too large.");body=JSON.parse(raw);if(!Number.isSafeInteger(body.revision)||body.revision<1||typeof body.batchId!=="string"||body.batchId.length>100||!["Draft","Issue"].includes(body.mode))throw new Error("Choose a saved batch revision and document mode.");}catch(error){return reply({error:error instanceof Error?error.message:"Invalid document request."},400);}
 const {data:saved,error:saveError}=await client.from("management_review_state").select("state,revision").eq("block_id",blockId).eq("area","financials").maybeSingle();
 if(saveError)return reply({error:"Saved financial preparation is unavailable. The reviewed management migration must be installed."},503);
 if(!saved||saved.revision!==body.revision)return reply({error:"The saved budget changed. Reload before generating its documents."},409);
 const {data:unitRows,error:unitError}=await client.from("units").select("id,block_id,unit_number,payment_reference").eq("block_id",blockId);
 if(unitError)return reply({error:"Unit scope could not be verified."},503);
 const units=(unitRows??[]).map(unit=>({id:unit.id,blockId:unit.block_id,unitNumber:unit.unit_number,paymentReference:unit.payment_reference}));
 const {data:documentSettings,error:settingsError}=await client.from("service_charge_document_settings").select("settings").eq("block_id",blockId).maybeSingle();
 if(settingsError)return reply({error:"Document settings could not be loaded; no formal documents generated."},503);
 try{
  const today=londonDate(),state=validateFinancialState(saved.state,blockId,units.map(unit=>unit.id),today);
  if(!state.prepared||state.prepared.input.batchId!==body.batchId)throw new Error("Choose the saved prepared batch.");
  const expected=await financialDraftToLedgerRows(state.prepared.input,units,true);
  const {data:entries,error:ledgerError}=await client.from("service_charge_entries").select("request_id,reference,unit_id,entry_type,description,amount_pence,entry_date,due_date").eq("block_id",blockId).in("request_id",expected.map(row=>row.request_id));
  if(ledgerError)return reply({error:"Ledger references could not be verified. No issued documents were generated."},503);
  const documents=await generateFinancialDocuments({state,revision:saved.revision,today,mode:body.mode,block:{id:block.id,name:block.name,address:block.address,managementCompany:block.management_company},units,settings:documentSettings?.settings as FinancialDocumentSettings|undefined,ledgerEntries:entries??[],documentReview:body.documentReview});
  return reply({documents,ledgerChanged:false,emailSent:false});
 }catch(error){return reply({error:error instanceof Error?error.message:"Document preparation failed."},400);}
}
