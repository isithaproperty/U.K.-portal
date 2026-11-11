import type {Resident} from "../app/types";
import {parseContactEmails} from "./leaseholder-planning.ts";
/** Prefill only. An uploaded resident row never grants financial recipient permission. */
export function residentContactReview(resident:Resident,blockId:number,unitIds:number[]){
 if(resident.blockId!==blockId||resident.archivedAt||!unitIds.includes(resident.unitId))throw Error("Choose a current resident assigned to a unit in this building.");
 const emails=parseContactEmails(resident.email);if(emails.length!==1)throw Error("Review one resident email at a time.");
 if(!resident.fullName.trim()||resident.fullName.length>200)throw Error("Review the resident name before adding a contact.");
 return {unitId:String(resident.unitId),name:resident.fullName.trim(),emails:emails[0],role:"" as const,demands:false,communications:false};
}
