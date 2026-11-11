/** Local-only integrity contract. Not connected to storage, routes or email transport.
 * Authorisation and whole-workbook safety inspection must happen on the server
 * before persisted metadata is accepted. A hash is not a safety scan.
 */
import {createHash} from "node:crypto";
import {validPlanningDate, planningPeriods} from "./financial-planning.ts";
export const BUDGET_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;
// Leaves room for the financial document under the existing 3 MB encoded envelope limit.
export const MAX_BUDGET_ATTACHMENT_BYTES = 2_000_000;
export type BudgetAttachmentVersion = Readonly<{
 versionId:string; blockId:number; yearStart:string; yearEnd:string;
 budgetRevision:number; fileName:string; mediaType:typeof BUDGET_XLSX_MEDIA_TYPE;
 byteLength:number; sha256:string;
}>;
export type BudgetAttachmentReview = Readonly<{
 version:BudgetAttachmentVersion; reviewToken:string;
}>;
function hash(bytes:Uint8Array|string){return createHash("sha256").update(bytes).digest("hex");}
function metadata(version:BudgetAttachmentVersion):BudgetAttachmentVersion {
 if(!version||!Number.isSafeInteger(version.blockId)||version.blockId<1||!Number.isSafeInteger(version.budgetRevision)||version.budgetRevision<1)throw Error("A saved building budget revision is required.");
 if(!validPlanningDate(version.yearStart)||!validPlanningDate(version.yearEnd)||planningPeriods(version.yearStart,"Annual")[0].end!==version.yearEnd)throw Error("Select the exact annual budget period.");
 if(typeof version.versionId!=="string"||!/^[a-zA-Z0-9_-]{1,100}$/.test(version.versionId))throw Error("An immutable budget version is required.");
 if(typeof version.fileName!=="string"||version.fileName.length>200||!version.fileName.trim()||/[\x00-\x1f\x7f/\\]/.test(version.fileName)||!version.fileName.toLowerCase().endsWith(".xlsx")||version.mediaType!==BUDGET_XLSX_MEDIA_TYPE)throw Error("Only a safe XLSX filename and content type are supported.");
 if(!Number.isSafeInteger(version.byteLength)||version.byteLength<4||version.byteLength>MAX_BUDGET_ATTACHMENT_BYTES||typeof version.sha256!=="string"||!/^[a-f0-9]{64}$/.test(version.sha256))throw Error("Budget attachment exceeds size limits or lacks its byte hash.");
 // Explicit fields avoid unknown input properties affecting the review contract.
 return Object.freeze({versionId:version.versionId,blockId:version.blockId,yearStart:version.yearStart,yearEnd:version.yearEnd,budgetRevision:version.budgetRevision,fileName:version.fileName,mediaType:version.mediaType,byteLength:version.byteLength,sha256:version.sha256});
}
/** Token only binds review to metadata; it does NOT prove permission or human approval. */
export function budgetAttachmentReview(version:BudgetAttachmentVersion):BudgetAttachmentReview {
 const checked=metadata(version);
 return Object.freeze({version:checked,reviewToken:hash(JSON.stringify(checked))});
}
/** Caller must supply trusted server-resolved version/scope and authenticated approval.
 * This checks integrity only. Existing transport intentionally rejects XLSX until
 * private storage, workbook inspection and transactional queue validation are ready.
 */
export function captureBudgetAttachment(input:{version:BudgetAttachmentVersion;bytes:Uint8Array;blockId:number;yearStart:string;budgetRevision:number;reviewToken:string;wholeWorkbookApproved:boolean}) {
 const review=budgetAttachmentReview(input.version),version=review.version;
 if(version.blockId!==input.blockId||version.yearStart!==input.yearStart||version.budgetRevision!==input.budgetRevision)throw Error("Budget building, year or saved revision does not match the document.");
 if(input.wholeWorkbookApproved!==true||input.reviewToken!==review.reviewToken)throw Error("Review the exact whole workbook again before attachment.");
 if(!(input.bytes instanceof Uint8Array)||input.bytes.byteLength!==version.byteLength||hash(input.bytes)!==version.sha256)throw Error("Original budget bytes changed or are unavailable.");
 return Object.freeze({fileName:version.fileName,mediaType:version.mediaType,encoding:"base64" as const,content:Buffer.from(input.bytes).toString("base64"),budgetVersion:version});
}
