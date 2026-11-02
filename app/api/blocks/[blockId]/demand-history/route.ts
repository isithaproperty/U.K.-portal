import {NextRequest} from "next/server";
import {managementAccess,managementReply as reply} from "../../../../../lib/management-access";
export async function GET(_request:NextRequest,{params}:{params:Promise<{blockId:string}>}){
 const access=await managementAccess(Number((await params).blockId));if(access.response)return access.response;
 const {data:summaries,error:summaryError}=await access.client.from("management_dispatch_summary").select("unit_id,last_demand_sent").eq("block_id",access.block.id);
 const {data,error}=await access.client.from("management_dispatches").select("idempotency_key,unit_id,kind,status,sent_at,scheduled_at,delivery_status,envelope").eq("block_id",access.block.id).in("kind",["Demand","Credit note","First reminder","Final reminder"]).order("scheduled_at",{ascending:false}).limit(500);
 if(error||summaryError)return reply({error:"Delivery history is unavailable until its reviewed migration is installed."},503);return reply({records:data,summaries,limit:500});
}
