/** Local-only test transport. No production credentials, database or mail provider. */
import {createServer} from 'node:http';
const saved=new Map(),ledger=new Map();
export const block={id:1,source_row:1,name:'Local Test Court',management_company:'Test Company',type:'Residential',address:'Synthetic address',units:1,manager:'London',financial_year_end:'2026-12-31',myblockman_export_enabled:false};
export const unit={id:10,block_id:1,unit_number:'Flat 1',payment_reference:'LOCAL1'};
export function sessionCookie(email='manager@example.invalid'){
 const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const access_token=`${b({alg:'HS256',typ:'JWT'})}.${b({sub:'00000000-0000-0000-0000-000000000001',email,role:'authenticated',aud:'authenticated',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})}.synthetic-test-signature`;
 const value={access_token,refresh_token:'local-test-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:{id:'00000000-0000-0000-0000-000000000001',email}};
 return `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
}
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:5440');let tokenEmail='';try{tokenEmail=JSON.parse(Buffer.from((req.headers.authorization??'').split('.')[1],'base64url')).email;}catch{}
 const send=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
 if(url.pathname==='/auth/v1/user'){if(!tokenEmail)return send({message:'Not signed in'},401);return send({id:'00000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated',email:tokenEmail,email_confirmed_at:'2026-01-01',app_metadata:{},user_metadata:{},identities:[],created_at:'2026-01-01'});}
 if(url.pathname.startsWith('/rest/v1/rpc/')){
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
  if(url.pathname.endsWith('save_management_review')){const key=`${body.p_block_id}:${body.p_area}`,previous=saved.get(key);if((previous?.revision??0)!==body.p_expected_revision)return send({code:'40001',message:'Revision conflict'},409);const next={state:body.p_state,revision:body.p_expected_revision+1,updated_at:new Date().toISOString()};saved.set(key,next);return send([next]);}
  if(url.pathname.endsWith('post_saved_management_batch')){const batch=saved.get(`${body.p_block_id}:financials`);if(!batch||batch.revision!==body.p_expected_revision||batch.state.prepared.input.batchId!==body.p_batch_id)return send({code:'40001',message:'Batch changed'},409);for(const row of body.p_rows){const existing=ledger.get(row.request_id);if(existing&&JSON.stringify(existing.row)!==JSON.stringify(row))return send({code:'P0001',message:'Conflicting replay'},400);if(!existing)ledger.set(row.request_id,{row,reference:`LOCAL-INV-${ledger.size+1}`});}return send(body.p_rows.length);}
 }
 const table=url.pathname.split('/').pop();let rows=[];
 if(table==='portal_members')rows=[{email:tokenEmail,role:tokenEmail.startsWith('tenant')?'resident':tokenEmail.startsWith('owner')?'owner':'manager',portfolio_manager:tokenEmail.startsWith('other')?'Other':'London'}];
 if(table==='blocks')rows=[block];if(table==='units')rows=[unit];
 if(table==='residents')rows=[{id:20,unit_id:10,block_id:1,full_name:'Example contact',email:'owner@example.invalid',phone:null,archived_at:null}];
 if(table==='management_review_state'){const area=(url.searchParams.get('area')??'').replace('eq.','');const found=saved.get(`1:${area}`);rows=found?[found]:[];}
 if(table==='service_charge_entries')rows=[...ledger.values()].map(x=>({reference:x.reference}));
 const object=(req.headers.accept??'').includes('object+json');send(object?(rows[0]??null):rows);
});
server.listen(5440,'127.0.0.1',()=>console.log('Local test Supabase transport ready on 5440'));
