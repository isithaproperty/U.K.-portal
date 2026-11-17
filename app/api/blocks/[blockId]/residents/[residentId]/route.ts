import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '../../../../../../lib/supabase/server';
import {canManageReviewBlock} from '../../../../../../lib/management-review';
import {validateResidentContactEdit} from '../../../../../../lib/resident-contact-edit';
type Context={params:Promise<{blockId:string;residentId:string}>};
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function access(context:Context){
 if(process.env.LONDON_RESIDENT_CONTACT_EDIT_ENABLED!=='true')return {response:reply({error:'Resident contact editing has not been activated.'},503)};
 const params=await context.params,blockId=Number(params.blockId),residentId=Number(params.residentId);
 if(!Number.isSafeInteger(blockId)||blockId<1||!Number.isSafeInteger(residentId)||residentId<1)return {response:reply({error:'Choose a valid resident and block.'},400)};
 const client=await createClient(),{data:{user},error:authError}=await client.auth.getUser();if(authError||!user?.email)return {response:reply({error:'Sign in required.'},401)};
 const {data:member,error:memberError}=await client.from('portal_members').select('email,role,portfolio_manager').eq('email',user.email.toLowerCase()).maybeSingle();
 const {data:block,error:blockError}=await client.from('blocks').select('manager').eq('id',blockId).maybeSingle();
 if(memberError||blockError||!block||!member||!canManageReviewBlock(member,block.manager))return {response:reply({error:'Manager block access required.'},403)};
 return {client,blockId,residentId};
}
export async function GET(request:NextRequest,context:Context){
 const scope=await access(context);if(scope.response)return scope.response;const {client,blockId,residentId}=scope;
 const {data:resident,error}=await client.from('residents').select('id,unit_id,block_id,full_name,email,contact_email,contact_version,phone,archived_at').eq('id',residentId).eq('block_id',blockId).maybeSingle();
 if(error)return reply({error:'Contact editing storage is unavailable. The reviewed migration is required.'},503);if(!resident)return reply({error:'Resident unavailable.'},404);
 const beforeRaw=request.nextUrl.searchParams.get('beforeVersion'),before=beforeRaw===null?null:Number(beforeRaw);if(before!==null&&(!Number.isSafeInteger(before)||before<1))return reply({error:'Choose a valid history version.'},400);
 let query=client.from('resident_contact_history').select('id,version,actor_email,actor_role,occurred_at,before_snapshot,after_snapshot',{count:'exact'}).eq('resident_id',residentId).eq('block_id',blockId).order('version',{ascending:false}).limit(20);if(before!==null)query=query.lt('version',before);
 const {data:history,error:historyError,count}=await query;if(historyError||count===null)return reply({error:'Contact audit history could not be verified.'},503);
 return reply({resident,history,historyCount:count});
}
export async function PATCH(request:NextRequest,context:Context){
 const origin=request.headers.get('origin');if(origin&&origin!==request.nextUrl.origin)return reply({error:'Same-origin request required.'},403);
 const scope=await access(context);if(scope.response)return scope.response;let body;
 try{const raw=await request.text();if(new TextEncoder().encode(raw).length>5000)throw Error('Contact details are too large.');body=validateResidentContactEdit(JSON.parse(raw));}catch(error){return reply({error:error instanceof Error?error.message:'Invalid contact details.'},400);}
 const {data,error}=await scope.client.rpc('update_resident_contact',{p_block_id:scope.blockId,p_resident_id:scope.residentId,p_expected_version:body.expectedVersion,p_full_name:body.fullName,p_contact_email:body.contactEmail,p_phone:body.phone});
 if(error){if(error.code==='40001')return reply({error:'This resident changed. Reload the saved details before editing.',uncertain:false},409);if(error.code==='42501')return reply({error:'Manager block access required.'},403);if(error.code==='P0002')return reply({error:'Resident unavailable.'},404);if(error.code==='P0001'||error.code==='23514'||error.code?.startsWith('22'))return reply({error:'Contact details were rejected. Check the name/email/phone and that the resident is current.',uncertain:false},400);if(['PGRST202','PGRST205','42P01','42883'].includes(error.code??''))return reply({error:'The reviewed contact-editing migration is not installed.',uncertain:false},503);return reply({error:'Save was not confirmed. Reload the saved details and audit history before retrying.',uncertain:true},503);}
 if(!data?.resident?.id)return reply({error:'Save returned no confirmed resident. Reload before retrying.',uncertain:true},503);
 return reply({...data,loginIdentityChanged:false,financialRecordsChanged:false,emailSent:false});
}
