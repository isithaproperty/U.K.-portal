import {createHmac,timingSafeEqual} from "node:crypto";
/** Verify raw bytes and bounded timestamp before JSON parsing. */
export function verifyManagementWebhook(raw:string,headers:{id:string|null;timestamp:string|null;signature:string|null},secret:string|undefined,nowSeconds=Math.floor(Date.now()/1000)){
 if(!secret?.startsWith("whsec_")||!headers.id||headers.id.length>200||!headers.timestamp||!/^\d+$/.test(headers.timestamp)||!headers.signature||headers.signature.length>2000||Math.abs(nowSeconds-Number(headers.timestamp))>300)return false;
 const key=Buffer.from(secret.slice(6),"base64");if(key.length<16)return false;
 const expected=createHmac("sha256",key).update(`${headers.id}.${headers.timestamp}.${raw}`).digest();
 return headers.signature.split(" ").some(part=>{const [version,value]=part.split(",");if(version!=="v1"||!value)return false;const received=Buffer.from(value,"base64");return received.length===expected.length&&timingSafeEqual(received,expected);});
}
