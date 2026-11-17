/** Mirrors the existing private bucket limits; does not authorize access or inspect file contents. */
export const SAFETY_DOCUMENT_LIMIT=10*1024*1024;
export const SAFETY_DOCUMENT_ACCEPT='.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';
export function validateSafetyDocument(file:{name:string;size:number;type:string}){
 if(!file.name||!Number.isSafeInteger(file.size)||file.size<=0||file.size>SAFETY_DOCUMENT_LIMIT)throw Error('Choose a nonempty PDF, JPEG, PNG or WebP file up to 10 MB.');
 const allowed=['application/pdf','image/jpeg','image/png','image/webp'];
 const extension=file.name.toLowerCase().split('.').at(-1)??'';
 const inferred:Record<string,string>={pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
 const type=file.type.toLowerCase();const contentType=(!type||type==='application/octet-stream')?inferred[extension]:type;
 if(!allowed.includes(contentType))throw Error('This folder accepts PDF, JPEG, PNG or WebP files. Convert other formats before uploading.');
 return {contentType};
}
