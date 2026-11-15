import type {Resident} from '../app/types';
export type ResidentContactEdit={expectedVersion:number;fullName:string;contactEmail:string;phone:string|null};
export function residentContactEmail(resident:Resident){return resident.contactEmail??resident.email;}
export function validateResidentContactEdit(value:unknown):ResidentContactEdit{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Provide resident contact details.');
 const raw=value as Record<string,unknown>,keys=['expectedVersion','fullName','contactEmail','phone'];
 if(Object.keys(raw).some(key=>!keys.includes(key))||keys.some(key=>!(key in raw)))throw Error('Only name, contact email and phone can be edited here.');
 if(!Number.isSafeInteger(raw.expectedVersion)||(raw.expectedVersion as number)<1)throw Error('Reload the saved resident before editing.');
 const clean=(v:unknown,max:number,required=false)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u001f\u007f]/.test(v)||required&&!v.trim())throw Error('Enter a name up to 200 characters, contact email up to 254 and phone up to 80.');return v.trim();};
 const fullName=clean(raw.fullName,200,true),contactEmail=clean(raw.contactEmail,254,true).toLowerCase(),phone=raw.phone===null?null:clean(raw.phone,80)||null;
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))throw Error('Enter a valid contact email address.');
 return {expectedVersion:raw.expectedVersion as number,fullName,contactEmail,phone};
}
