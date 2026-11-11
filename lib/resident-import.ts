/** Resident/unit CSV headers. Source IDs and descriptions are deliberately ignored. */
export const residentFields = ['unit_number','resident_name','resident_email','phone','payment_reference','service_charge_percentage','unit_code'] as const;
export type ResidentImportRow = Record<typeof residentFields[number], string>;
const aliases: Record<string,string> = {
 unitnumber:'unit_number',unitname:'unit_number',unitcode:'unit_code',residentname:'resident_name',residentemail:'resident_email',phone:'phone',paymentreference:'payment_reference',servicechargepercentage:'service_charge_percentage',id:'ignored_id',unitdescription:'ignored_description',
};
export function residentCsvRows(records:string[][]):ResidentImportRow[]{
 const columns=records[0]?.map(h=>aliases[h.trim().toLowerCase().replace(/[\s_()]/g,'')]);
 if(!columns?.length||columns.some(h=>!h)||new Set(columns).size!==columns.length||!columns.includes('unit_number'))throw new Error('Use the resident template or a unit CSV with Unit Name and optional Service Charge (Percentage). Headers must be unique.');
 return records.slice(1).map(values=>{
  if(values.length!==columns.length)throw new Error('Each row must match the header column count. Correct missing cells; unit identities are never inferred.');
  return Object.fromEntries(residentFields.map(key=>[key,values[columns.indexOf(key)]??''])) as ResidentImportRow;
 });
}
export function validSourcePercentage(value:string):boolean {
 return /^\d{1,3}(?:\.\d{1,12})?$/.test(value)&&Number(value)<=100;
}
/** Exact labels only: never strip Flat, punctuation or leading zeros, or trust external IDs. */
export function resolveResidentUnits(rows:ResidentImportRow[], units:{unit_number:string}[]):ResidentImportRow[]{
 const key=(v:string)=>v.trim().toLowerCase();
 const shares=new Map<string,number>();const references=new Map<string,string>();
 const sourceCodes=new Map<string,string>();
 const knownUnits=[...units];
 return rows.map(row=>{
  const matches=knownUnits.filter(unit=>key(unit.unit_number)===key(row.unit_number)||(row.unit_code&&key(unit.unit_number)===key(row.unit_code)));
  if(matches.length>1)throw new Error(`Ambiguous unit ${row.unit_number}. Correct the building register or source labels first.`);
  const number=matches[0]?.unit_number??row.unit_number;
  const identity=key(number);
  if(!matches.length)knownUnits.push({unit_number:number});
  if(row.unit_code){const previous=sourceCodes.get(key(row.unit_code));if(previous&&previous!==identity)throw new Error(`Unit code ${row.unit_code} has conflicting names.`);sourceCodes.set(key(row.unit_code),identity);}
  if(row.service_charge_percentage){
   if(!validSourcePercentage(row.service_charge_percentage))throw new Error('Service charge percentages must be between 0 and 100, with up to 12 decimal places.');
   const value=Number(row.service_charge_percentage);
   if(shares.has(identity)&&shares.get(identity)!==value)throw new Error(`Conflicting service charge percentages for ${number}. Joint residents must share one unit percentage.`);
   shares.set(identity,value);
  }
  if(row.payment_reference){if(references.has(identity)&&references.get(identity)!==row.payment_reference)throw new Error(`Conflicting payment references for ${number}.`);references.set(identity,row.payment_reference);}
  return {...row,unit_number:number};
 });
}
