export type ResidentSignIn={state:'signed_in'|'never_recorded'|'no_account'|'unavailable';lastSignInAt:string|null};
const unavailable:ResidentSignIn={state:'unavailable',lastSignInAt:null};
/** Validate the narrow RPC response. Uncertain data is not interpreted as never. */
export function parseResidentSignIns(value:unknown):Map<number,ResidentSignIn>{
 if(!Array.isArray(value))throw Error('Sign-in information unavailable.');
 const result=new Map<number,ResidentSignIn>();
 for(const raw of value){
  if(!raw||typeof raw!=='object'||!Number.isSafeInteger(raw.resident_id)||raw.resident_id<1||result.has(raw.resident_id))throw Error('Sign-in information unavailable.');
  let info:ResidentSignIn=unavailable;
  if(['never_recorded','no_account','unavailable'].includes(raw.state)&&raw.last_sign_in_at===null)info={state:raw.state,lastSignInAt:null};
  else if(raw.state==='signed_in'&&typeof raw.last_sign_in_at==='string'&&Number.isFinite(Date.parse(raw.last_sign_in_at)))info={state:'signed_in',lastSignInAt:raw.last_sign_in_at};
  result.set(raw.resident_id,info);
 }
 return result;
}
export function residentSignInLabel(info:ResidentSignIn|undefined){
 if(info?.state==='no_account')return 'Not available — no linked sign-in account';
 if(info?.state==='never_recorded')return 'Never recorded';
 if(info?.state==='signed_in'&&info.lastSignInAt&&Number.isFinite(Date.parse(info.lastSignInAt)))return new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/London'}).format(new Date(info.lastSignInAt))+' (London time)';
 return 'Not available';
}
