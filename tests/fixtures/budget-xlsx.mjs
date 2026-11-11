import {deflateRawSync} from 'node:zlib';
function crc32(b){let c=0xffffffff;for(const x of b){c^=x;for(let i=0;i<8;i++)c=c>>>1^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
// Minimal synthetic OOXML/ZIP byte fixtures, never copies of resident data.
export function fixture(options={}){
 const sheet=options.sheet??'<row r="1"><c r="A1" t="inlineStr"><is><t>CategoryName</t></is></c><c r="B1" t="inlineStr"><is><t>Budget 2027</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Cleaning</t></is></c><c r="B2"><v>123.45</v></c></row><row r="3"><c r="B3"><f>SUM(B2)</f><v>123.45</v></c></row>';
 const files={'xl/workbook.xml':'<workbook xmlns:r="urn:rel"><sheets><sheet name="Summary" r:id="rId1"/><sheet name="Detail" r:id="rId2"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/>'+ (options.external?'<Relationship Id="link" TargetMode="External" Target="https://example.test"/>':'')+'</Relationships>','xl/worksheets/sheet1.xml':'<worksheet><sheetData>'+sheet+'</sheetData></worksheet>','xl/worksheets/sheet2.xml':'<worksheet><sheetData/></worksheet>',...options.files};
 let offset=0;const locals=[],central=[];
 for(const [name,value] of Object.entries(files)){
  const raw=Buffer.from(value),packed=options.stored?raw:deflateRawSync(raw),n=Buffer.from(name),size=options.bomb?1:raw.length,crc=crc32(raw);
  const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(options.stored?0:8,8);l.writeUInt32LE(crc,14);l.writeUInt32LE(packed.length,18);l.writeUInt32LE(size,22);l.writeUInt16LE(n.length,26);locals.push(l,n,packed);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(options.encrypted?1:0,8);c.writeUInt16LE(options.stored?0:8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(size,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);offset+=l.length+n.length+packed.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 const b=Buffer.concat([...locals,directory,end]);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
}
