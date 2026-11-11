/** Read-only OOXML subset. No formula engine, external requests, files or database writes. */
import {XMLParser,XMLValidator} from 'fast-xml-parser';
export const XLSX_LIMITS={file:2*1024*1024,entry:2*1024*1024,expanded:8*1024*1024,entries:128,sheets:16,rows:1000,columns:64,cells:20000,text:10000};
export type BudgetWorkbook={sheets:{name:string;rows:string[][]}[];cachedFormulaCount:number};
function fail(message:string):never{throw new Error(message);}
const decoder=new TextDecoder('utf-8',{fatal:true});
function crc32(bytes:Uint8Array){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
async function unzip(buffer:ArrayBuffer){
 if(buffer.byteLength>XLSX_LIMITS.file)fail('XLSX files must be no larger than 2 MB.');
 const bytes=new Uint8Array(buffer),view=new DataView(buffer);const u16=(p:number)=>view.getUint16(p,true),u32=(p:number)=>view.getUint32(p,true);
 let end=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(u32(p)===0x06054b50&&p+22+u16(p+20)===bytes.length){end=p;break;}
 if(end<0)fail('Invalid XLSX ZIP container. Choose an unencrypted .xlsx workbook.');
 if(u16(end+4)||u16(end+6)||u16(end+8)!==u16(end+10))fail('Multi-part ZIP workbooks are unsupported.');
 const count=u16(end+10),start=u32(end+16);if(!count||count>XLSX_LIMITS.entries||start+u32(end+12)!==end)fail('Workbook ZIP structure or entry limit is invalid.');
 const files=new Map<string,Uint8Array>();let p=start,expanded=0;const ranges:[number,number][]=[];
 for(let n=0;n<count;n++){
  if(p+46>end||u32(p)!==0x02014b50)fail('Invalid workbook directory.');
  const flags=u16(p+8),method=u16(p+10),crc=u32(p+16),compressed=u32(p+20),size=u32(p+24),nameLength=u16(p+28),extra=u16(p+30),comment=u16(p+32),local=u32(p+42);
  if(p+46+nameLength+extra+comment>end)fail('Truncated workbook directory.');
  const name=decoder.decode(bytes.subarray(p+46,p+46+nameLength));p+=46+nameLength+extra+comment;
  if(flags&~(0x800|8|6)||![0,8].includes(method)||u16(p-46-nameLength-extra-comment+34))fail('Encrypted or unsupported workbook ZIP entry.');
  if(!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(s=>s==='..'||s==='.')||files.has(name))fail('Invalid or duplicate workbook part.');
  if(/(?:vbaProject|externalLinks|embeddings|activeX)/i.test(name))fail('Macros, embedded files and external workbook links are unsupported.');
  expanded+=size;if(size>XLSX_LIMITS.entry||expanded>XLSX_LIMITS.expanded)fail('Workbook exceeds the 2 MB per-part or 8 MB expanded limit.');
  if(local+30>start||u32(local)!==0x04034b50||u16(local+6)!==flags||u16(local+8)!==method)fail('Invalid workbook local header.');
  const data=local+30+u16(local+26)+u16(local+28),finish=data+compressed;
  if(finish>start||decoder.decode(bytes.subarray(local+30,local+30+u16(local+26)))!==name||ranges.some(([a,b])=>local<b&&finish>a))fail('Invalid or overlapping workbook entries.');
  ranges.push([local,finish]);
  let output:Uint8Array;
  if(method===0){if(compressed!==size)fail('Invalid stored workbook entry.');output=bytes.slice(data,finish);}
  else{
   if(typeof DecompressionStream==='undefined')fail('This browser cannot read XLSX. Use an up-to-date browser or export Summary as CSV.');
   let decompressor:DecompressionStream;
   try{decompressor=new DecompressionStream('deflate-raw');}catch{fail('This browser cannot read compressed XLSX files. Use an up-to-date browser or export Summary as CSV.');}
   const stream=new Blob([bytes.slice(data,finish)]).stream().pipeThrough(decompressor);
   const reader=stream.getReader();output=new Uint8Array(size);let used=0;
   try{while(true){const chunk=await reader.read();if(chunk.done)break;if(used+chunk.value.length>size){await reader.cancel();fail('Workbook expanded data exceeds its declared size.');}output.set(chunk.value,used);used+=chunk.value.length;}if(used!==size)fail('Truncated workbook data.');}finally{reader.releaseLock();}
  }
  if(crc32(output)!==crc)fail('Workbook data checksum failed.');files.set(name,output);
 }
 if(p!==end)fail('Invalid workbook directory length.');return files;
}
// Validation occurs before parsing, with DTDs/entities forbidden and bounded nesting.
function xml(bytes:Uint8Array|undefined){
 if(!bytes)fail('Workbook is missing a required XML part.');const text=decoder.decode(bytes);
 if(/<!DOCTYPE|<!ENTITY/i.test(text))fail('XML document types and custom entities are unsupported.');
 let depth=0,tags=0;for(const match of text.matchAll(/<\/?[A-Za-z_][^>]*>/g)){if(++tags>150000)fail('Workbook XML has too many elements.');if(match[0].startsWith('</'))depth--;else if(!match[0].endsWith('/>'))depth++;if(depth>64||depth<0)fail('Workbook XML nesting is invalid or too deep.');}
 if(XMLValidator.validate(text)!==true)fail('Workbook contains malformed XML.');
 return new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',parseTagValue:false,parseAttributeValue:false,trimValues:false,removeNSPrefix:true}).parse(text);
}
const list=<T>(value:T|T[]|undefined):T[]=>value===undefined?[]:Array.isArray(value)?value:[value];
// Parsed XML stays confined to this validated reader; only strings leave it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rich(value:any):string{if(typeof value==='string')return value;if(value==null)return '';if(value.t!==undefined)return typeof value.t==='object'?String(value.t['#text']??''):String(value.t);return list(value.r).map(rich).join('');}
function excelDate(value:string,date1904:boolean){const n=Number(value);if(!Number.isInteger(n)||n<61||n>100000)fail('Invalid Excel budget date.');return new Date(Date.UTC(1899,11,30)+(n+(date1904?1462:0))*86400000).toISOString().slice(0,10);}
export async function parseBudgetWorkbook(buffer:ArrayBuffer):Promise<BudgetWorkbook>{
 const files=await unzip(buffer),book=xml(files.get('xl/workbook.xml')).workbook;
 const rels=xml(files.get('xl/_rels/workbook.xml.rels')).Relationships;
 // Do not follow relationships. Any external relationship anywhere blocks import.
 for(const [name,bytes] of files)if(name.endsWith('.rels')){const doc=xml(bytes);for(const rel of list<any>(doc.Relationships?.Relationship))if(rel['@_TargetMode']==='External')fail('External workbook relationships are unsupported. Remove links or export Summary as CSV.');}
 const targets=new Map<string,string>();for(const rel of list<any>(rels?.Relationship)){const target=String(rel['@_Target']??'');if(target.includes('..')||target.includes('\\')||target.includes(':'))fail('Invalid workbook relationship.');if(targets.has(rel['@_Id']))fail('Duplicate workbook relationship.');targets.set(rel['@_Id'],target.startsWith('/xl/')?target.slice(1):`xl/${target}`);}
 const shared=files.has('xl/sharedStrings.xml')?list<any>(xml(files.get('xl/sharedStrings.xml')).sst?.si).map(rich):[];
 if(shared.length>XLSX_LIMITS.cells||shared.some(s=>s.length>XLSX_LIMITS.text))fail('Workbook text limit exceeded.');
 const sourceSheets=list<any>(book?.sheets?.sheet);if(!sourceSheets.length||sourceSheets.length>XLSX_LIMITS.sheets)fail('Workbook must have 1 to 16 worksheets.');
 let cellCount=0,cachedFormulaCount=0;const names=new Set<string>();
 const sheets=sourceSheets.map(sheet=>{
  const name=String(sheet['@_name']??'');if(!name||names.has(name))fail('Invalid worksheet names.');names.add(name);
  const doc=xml(files.get(targets.get(sheet['@_id'])??''));if(!doc.worksheet)fail('Only standard Excel worksheets are supported.');
  const rows:string[][]=[];const occupied=new Set<string>();
  for(const row of list<any>(doc.worksheet.sheetData?.row))for(const cell of list<any>(row.c)){
   if(++cellCount>XLSX_LIMITS.cells)fail('Workbook exceeds 20,000 cells.');
   const address=String(cell['@_r']??''),match=address.match(/^([A-Z]{1,3})([1-9]\d*)$/);if(!match||occupied.has(address))fail('Invalid or duplicate worksheet cell.');occupied.add(address);
   const r=Number(match[2])-1,c=[...match[1]].reduce((n,x)=>n*26+x.charCodeAt(0)-64,0)-1;
   if(r>=XLSX_LIMITS.rows||c>=XLSX_LIMITS.columns)fail('Worksheets are limited to 1,000 rows and 64 columns.');
   const formula=cell.f!==undefined;let value=String(cell.v??'');
   if(formula){cachedFormulaCount++;if(cell.v===undefined) value='#MISSING_FORMULA_CACHE';}
   if(cell['@_t']==='s'){if(!/^\d+$/.test(value)||Number(value)>=shared.length)fail('Invalid shared string reference.');value=shared[Number(value)];}
   else if(cell['@_t']==='inlineStr')value=rich(cell.is);
   else if(cell['@_t']==='e')value='#EXCEL_ERROR';
   else if(!cell['@_t']||cell['@_t']==='n'){
    // Excel can store 1310.40 as 1310.4000000000001. Normalize only floating-point noise, not real fractional pennies.
    const n=Number(value);if(value&&Number.isFinite(n)&&Math.abs(n*100-Math.round(n*100))<1e-6)value=(Math.round(n*100)/100).toString();
   }
   if(value.length>XLSX_LIMITS.text)fail('Workbook cell text exceeds 10,000 characters.');
   while(rows.length<=r)rows.push([]);while(rows[r].length<=c)rows[r].push('');rows[r][c]=value;
  }
  for(const row of rows)if(/^(from|to)$/i.test((row[0]??'').trim())&&/^\d+$/.test(row[1]??''))row[1]=excelDate(row[1],book.workbookPr?.['@_date1904']==='1'||book.workbookPr?.['@_date1904']==='true');
  return {name,rows};
 });return {sheets,cachedFormulaCount};
}
