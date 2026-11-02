import {NextRequest,NextResponse} from "next/server";
import {createClient} from "../../../../../lib/supabase/server";
import {canManageReviewBlock} from "../../../../../lib/management-review";
import {financialDraftToLedgerRows,validateFinancialState} from "../../../../../lib/financial-planning";
import {londonDate} from "../../../../../lib/service-charges";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request:NextRequest,{params}:{params:Promise<{blockId:string}>}){
 // Default disabled. A separate reviewed activation is required before real ledger writes.
 if(process.env.LONDON_LEDGER_BATCHES_ENABLED!=="1")return reply({error:"Bulk ledger posting is disabled pending review and database verification. No entries were posted."},503);
 const blockId=Number((await params).blockId);
 if(!Number.isSafeInteger(blockId)||blockId<1)return reply({error:"Invalid block."},400);
 const client=await createClient();const {data:{user},error:authError}=await client.auth.getUser();
 if(authError||!user?.email)return reply({error:"Sign in required."},401);
 const {data:member,error:memberError}=await client.from("portal_members").select("role,portfolio_manager").eq("email",user.email.toLowerCase()).maybeSingle();
 if(memberError||!member||!["owner","admin","manager"].includes(member.role))return reply({error:"Manager access required."},403);
 const {data:block,error:blockError}=await client.from("blocks").select("id,manager").eq("id",blockId).maybeSingle();
 if(blockError||!block)return reply({error:"Block unavailable."},404);
 if(!canManageReviewBlock(member,block.manager))return reply({error:"Block is outside your management portfolio."},403);
 let body;
 try{const raw=await request.text();if(raw.length>10000)throw new Error("Invalid approval payload.");body=JSON.parse(raw);if(body.approved!==true||!Number.isSafeInteger(body.revision)||body.revision<1||typeof body.batchId!=="string"||body.batchId.length>100)throw new Error("Explicit approval of a saved batch revision is required.");}catch(error){return reply({error:error instanceof Error?error.message:"Invalid approval."},400);}
 const {data:saved,error:saveError}=await client.from("management_review_state").select("state,revision").eq("block_id",blockId).eq("area","financials").maybeSingle();
 if(saveError)return reply({error:"Saved batch storage is unavailable."},503);
 if(!saved||saved.revision!==body.revision)return reply({error:"The saved budget changed. Reload and approve the latest revision."},409);
 const {data:unitRows,error:unitError}=await client.from("units").select("id,block_id,unit_number").eq("block_id",blockId);
 if(unitError)return reply({error:"Unit scope could not be verified."},503);
 const units=(unitRows??[]).map(row=>({id:row.id,blockId:row.block_id,unitNumber:row.unit_number}));
 let rows;
 try{const state=validateFinancialState(saved.state,blockId,units.map(unit=>unit.id),londonDate());if(!state.prepared||state.prepared.input.batchId!==body.batchId)throw new Error("Choose the saved prepared batch.");rows=await financialDraftToLedgerRows(state.prepared.input,units,true);}catch(error){return reply({error:error instanceof Error?error.message:"Invalid saved batch."},400);}
 // The existing RPC is atomic and enforces RLS, including unit/block scope.
 // Deterministic row UUIDs reuse its request_id uniqueness on every retry.
 const {data,error}=await client.rpc("post_saved_management_batch",{p_block_id:blockId,p_batch_id:body.batchId,p_expected_revision:body.revision,p_rows:rows});
 if(error?.code==="40001")return reply({error:"The saved budget changed before posting. Reload and approve the latest revision."},409);
 if(error)return reply({error:"Posting was not confirmed. Reload the account before retrying; the same saved batch retains its request IDs."},503);
 const {data:entries,error:readError}=await client.from("service_charge_entries").select("reference").eq("block_id",blockId).in("request_id",rows.map(row=>row.request_id));
 if(readError)return reply({error:"Ledger import completed, but invoice numbers could not be read. Reload accounts before any retry.",posted:true,imported:data},503);
 return reply({imported:data,generated:(entries??[]).map(entry=>entry.reference),emailSent:false});
}
