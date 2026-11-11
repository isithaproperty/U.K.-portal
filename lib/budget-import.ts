/** Local-only CSV preparation. No imports here perform database or network writes. */
export type BudgetCsvTable={rows:string[][];headerIndex:number;headers:string[];blockName:string;startDate:string;endDate:string};
const MAX_BYTES=2*1024*1024;
const MAX_ROWS=1000;
export function parseCsv(text:string):string[][]{
 if(typeof text!=="string"||new TextEncoder().encode(text).length>MAX_BYTES)throw new Error("CSV must be no larger than 2 MB.");
 text=text.replace(/^\uFEFF/,"");
 const rows:string[][]=[];let row:string[]=[],field="",quoted=false,closed=false;
 function cell(){row.push(field);field="";closed=false;}
 function line(){cell();rows.push(row);row=[];if(rows.length>MAX_ROWS)throw new Error("CSV must contain at most 1,000 rows.");}
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c===','){cell();continue;}
  if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;line();continue;}
  if(closed)throw new Error("Unexpected text after a quoted CSV field.");
  if(c==='"'){if(field.length)throw new Error("Unexpected quote in CSV field.");quoted=true;continue;}
  field+=c;
 }
 if(quoted)throw new Error("CSV contains an unclosed quoted field.");
 if(field.length||row.length||closed)line();
 if(!rows.some(r=>r.some(v=>v.trim())))throw new Error("CSV is empty.");
 return rows;
}
function normalized(value:string){return value.trim().toLowerCase().replace(/\s+/g,"");}
function dateValue(value:string):string{
 const clean=value.trim();if(!clean)return "";
 let date=clean.match(/^(\d{4})-(\d{2})-(\d{2})(?: 00:00:00)?$/)?.slice(1).join("-")??"";
 const british=clean.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(british)date=`${british[3]}-${british[2]}-${british[1]}`;
 if(!date||!Number.isFinite(Date.parse(date))||new Date(`${date}T12:00:00Z`).toISOString().slice(0,10)!==date)throw new Error("Budget dates must be valid YYYY-MM-DD or DD/MM/YYYY dates.");
 return date;
}
export function inspectBudgetCsv(text:string):BudgetCsvTable{
 const rows=parseCsv(text);
 const headerIndex=rows.findIndex(row=>row.some(value=>normalized(value)==="categoryname"));
 if(headerIndex<0)throw new Error("Choose the Summary CSV containing a CategoryName or Category Name column.");
 const headers=rows[headerIndex].map(value=>value.trim());
 if(headers.filter(value=>normalized(value)==="categoryname").length!==1)throw new Error("CSV has ambiguous category columns.");
 const metadata:Record<string,string>={};
 for(const row of rows.slice(0,headerIndex)){
  const key=normalized(row[0]??"");if(["blockname","from","to"].includes(key)){
   if(key in metadata)throw new Error("CSV contains duplicate budget metadata.");metadata[key]=(row[1]??"").trim();
  }
 }
 const startDate=dateValue(metadata.from??""),endDate=dateValue(metadata.to??"");
 if(startDate&&endDate&&endDate<startDate)throw new Error("Budget end date precedes its start date.");
 return {rows,headerIndex,headers,blockName:metadata.blockname??"",startDate,endDate};
}
function pounds(value:string):number{
 const clean=value.trim().replace(/^£\s*/,"");
 if(!/^(?:\d{1,7}|\d{1,3}(?:,\d{3}){1,2})(?:\.\d{1,2})?$/.test(clean))throw new Error("Budget amounts must be nonnegative pounds with at most two decimal places.");
 const [whole,fraction=""]=clean.replaceAll(",","").split(".");
 const result=Number(whole)*100+Number(fraction.padEnd(2,"0"));
 if(!Number.isSafeInteger(result)||result>999999999)throw new Error("Budget amounts cannot exceed £9,999,999.99.");return result;
}
export function buildBudgetPreview(table:BudgetCsvTable,amountColumn:number):{categories:{name:string;amountPence:number}[];totalPence:number}{
 const categoryColumn=table.headers.findIndex(value=>normalized(value)==="categoryname");
 if(!Number.isInteger(amountColumn)||amountColumn<0||amountColumn>=table.headers.length||amountColumn===categoryColumn||!table.headers[amountColumn].trim())throw new Error("Choose a budget amount column.");
 const categories:{name:string;amountPence:number}[]=[];const names=new Set<string>();const totals:number[]=[];
 for(const row of table.rows.slice(table.headerIndex+1)){
  if(!row.some(value=>value.trim()))continue;
  if(row.length>table.headers.length&&row.slice(table.headers.length).some(value=>value.trim()))throw new Error("A budget row has more columns than its header.");
  const name=(row[categoryColumn]??"").trim(),amount=(row[amountColumn]??"").trim();
  if(!name||/^(?:grand\s+)?totals?$/i.test(name)){
   if(amount)totals.push(pounds(amount));
   else if(row.some(value=>value.trim()))throw new Error("A nonempty total row has no amount in the selected budget column.");
   continue;
  }
  if(!amount)throw new Error(`Missing budget amount for ${name}. Enter 0 when no budget applies.`);
  const key=name.toLowerCase();if(names.has(key))throw new Error(`Duplicate budget category: ${name}.`);names.add(key);
  categories.push({name,amountPence:pounds(amount)});
 }
 if(!categories.length)throw new Error("No budget categories found.");
 const totalPence=categories.reduce((sum,item)=>sum+item.amountPence,0);
 if(totalPence<=0||totalPence>999999999)throw new Error("Total budget must be positive and no more than £9,999,999.99.");
 if(totals.some(total=>total!==totalPence))throw new Error("The selected column's total does not match its category amounts.");
 return {categories,totalPence};
}
const SCALE=1000000000000n;
function percentageWeight(value:string):bigint{
 if(!/^\d{1,3}(?:\.\d{1,12})?$/.test(value))throw new Error("Percentages need a number from 0 to 100 with up to 12 decimal places.");
 const [whole,decimal=""]=value.split(".");const weight=BigInt(whole)*SCALE+BigInt(decimal.padEnd(12,"0"));
 if(weight>100n*SCALE)throw new Error("Percentages must be between 0 and 100.");return weight;
}
export function parseUnitSharesCsv(text:string):{code:string;name:string;percentage:string}[]{
 const rows=parseCsv(text).filter(row=>row.some(value=>value.trim()));const headers=rows[0].map(value=>value.trim());
 const names=["Unit Code","Unit Name","Service Charge (Percentage)"];
 const indexes=names.map(name=>{if(headers.filter(h=>h===name).length!==1)throw new Error(`Unit CSV needs one ${name} column.`);return headers.indexOf(name);});
 const seen=new Set<string>();
 const result=rows.slice(1).map(row=>{
  if(row.length!==headers.length)throw new Error("Unit CSV rows must match the header column count.");
  const [code,name,percentage]=indexes.map(index=>row[index].trim());
  if(!code||!name||code.length>100||name.length>200)throw new Error("Each unit needs a valid code and name.");
  const key=code.toLowerCase();if(seen.has(key))throw new Error(`Duplicate unit code: ${code}.`);seen.add(key);
  percentageWeight(percentage);return {code,name,percentage};
 });
 if(!result.length)throw new Error("Unit CSV has no units.");return result;
}
function decimal(weight:bigint):string{return `${weight/SCALE}.${(weight%SCALE).toString().padStart(12,"0")}`.replace(/\.?0+$/,"");}
/** Requires review: only tiny source rounding discrepancies are reconcilable. */
export function reconcileShares(rows:{unitId:number;percentage:string}[]):{percentages:Record<number,string>;sourceTotal:string;adjusted:boolean}{
 if(!rows.length||rows.length>MAX_ROWS||rows.some(row=>!Number.isSafeInteger(row.unitId)||row.unitId<=0)||new Set(rows.map(row=>row.unitId)).size!==rows.length)throw new Error("Map each imported share to a distinct valid unit.");
 const weights=rows.map(row=>({...row,weight:percentageWeight(row.percentage)}));const sum=weights.reduce((total,row)=>total+row.weight,0n);
 const delta=sum-100n*SCALE;
 if(sum===0n||delta>1000000000n||delta< -1000000000n)throw new Error("Lease percentages must total 100% (rounding tolerance: 0.001%).");
 const apportioned=weights.map(row=>({...row,ticks:row.weight*1000000n/sum,remainder:row.weight*1000000n%sum}));
 let remaining=1000000n-apportioned.reduce((total,row)=>total+row.ticks,0n);
 for(const row of [...apportioned].sort((a,b)=>a.remainder===b.remainder?a.unitId-b.unitId:a.remainder>b.remainder?-1:1)){if(remaining--<=0n)break;row.ticks++;}
 return {percentages:Object.fromEntries(apportioned.map(row=>[row.unitId,`${row.ticks/10000n}.${(row.ticks%10000n).toString().padStart(4,"0")}`])),sourceTotal:decimal(sum),adjusted:apportioned.some(row=>row.ticks*100000000n!==row.weight)};
}
