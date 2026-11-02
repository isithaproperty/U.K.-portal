import type {ChargeEntry} from "./service-charges";

export type AgedAccount = {
  balance: number;
  notDue: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days91plus: number;
  lastPayment: ChargeEntry | null;
};
const dayNumber = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A valid YYYY-MM-DD date is required.");
  const value = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error("Invalid calendar date.");
  return value / 86_400_000;
};

/** Same oldest-due-first settlement as the live unit ledger, scoped to one account. */
export function agedAccount(entries: ChargeEntry[], today: string): AgedAccount {
  const asOf = dayNumber(today);
  if (new Set(entries.map(e => `${e.block_id}/${e.unit_id}`)).size > 1) throw new Error("Age one unit account at a time.");
  const posted = entries.filter(e => {dayNumber(e.entry_date); return e.entry_date <= today;});
  if (posted.some(e => !Number.isSafeInteger(e.amount_pence) || e.amount_pence <= 0)) throw new Error("Ledger amounts must be positive integer pence.");
  const payments = posted.filter(e => e.entry_type === "Payment");
  const credits = posted.filter(e => e.entry_type === "Credit");
  const charges = posted.filter(e => e.entry_type === "Charge").sort((a, b) => (a.due_date ?? a.entry_date).localeCompare(b.due_date ?? b.entry_date) || a.id - b.id);
  let settlement = [...payments, ...credits].reduce((sum, e) => sum + e.amount_pence, 0);
  const result: AgedAccount = {balance: charges.reduce((sum,e) => sum + e.amount_pence,0) - settlement, notDue:0, days1to30:0, days31to60:0, days61to90:0, days91plus:0, lastPayment:[...payments].sort((a,b) => b.entry_date.localeCompare(a.entry_date) || b.id-a.id)[0] ?? null};
  for (const charge of charges) {
    const applied = Math.min(charge.amount_pence, settlement);
    settlement -= applied;
    const outstanding = charge.amount_pence - applied;
    const days = charge.due_date ? asOf - dayNumber(charge.due_date) : 0;
    if (days <= 0) result.notDue += outstanding;
    else if (days <= 30) result.days1to30 += outstanding;
    else if (days <= 60) result.days31to60 += outstanding;
    else if (days <= 90) result.days61to90 += outstanding;
    else result.days91plus += outstanding;
  }
  return result;
}

export type ReminderDraft = {
  id: string; unitId: number; stage: "First reminder" | "Final reminder";
  preparedAt: string; recipients: string[]; subject: string; body: string;
  accountNote: string; attachment: {fileName: string; mediaType: "text/plain"; content: string};
  deliveryStatus: "Draft — not sent";
};
export function captureReminder(draft: Omit<ReminderDraft, "deliveryStatus">): ReminderDraft {
  if (!["First reminder", "Final reminder"].includes(draft.stage)) throw new Error("Choose a valid reminder stage.");
  if (typeof draft.id!=="string"||!draft.id.trim()||draft.id.length>100||!Number.isSafeInteger(draft.unitId) || draft.unitId <= 0 || typeof draft.subject!=="string"||!draft.subject.trim() || typeof draft.body!=="string"||!draft.body.trim()) throw new Error("Choose an account and complete the email subject and message.");
  if(typeof draft.accountNote!=="string"||draft.accountNote.length>20000||draft.subject.length>1000||draft.body.length>100000||!Array.isArray(draft.recipients)||draft.recipients.length>100||draft.recipients.some(email=>typeof email!=="string"))throw new Error("Reminder content exceeds review limits or has invalid fields.");
  const recipients = [...new Set(draft.recipients.map(e => e.trim().toLowerCase()).filter(Boolean))];
  if (!recipients.length || recipients.some(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) throw new Error("Add valid, verified leaseholder recipient addresses.");
  if (!draft.attachment||draft.attachment.mediaType!=="text/plain"||typeof draft.attachment.fileName!=="string"||!draft.attachment.fileName.trim()||draft.attachment.fileName.length>250||typeof draft.attachment.content!=="string"||!draft.attachment.content.trim()||draft.attachment.content.length>200000) throw new Error("An exact document snapshot is required within review limits.");
  if (typeof draft.preparedAt!=="string"||!/^\d{4}-\d{2}-\d{2}T/.test(draft.preparedAt)||!Number.isFinite(Date.parse(draft.preparedAt))) throw new Error("A preparation timestamp is required.");
  return {...draft, recipients, attachment:{...draft.attachment}, deliveryStatus:"Draft — not sent"};
}
export function retainReminder(history: ReminderDraft[], draft: ReminderDraft): ReminderDraft[] {
  return history.some(item => item.id === draft.id) ? history : [...history, draft];
}
export type StandingOrderMode = "Payment allocation review" | "Invoice preparation review";
export type DebtorReviewState = {notes:Record<number,string>;history:ReminderDraft[];mode:StandingOrderMode;receipt:string};
export function readDebtorReviewState(value:unknown,unitIds:number[]):DebtorReviewState {
  if(value===null||value===undefined)return {notes:{},history:[],mode:"Payment allocation review",receipt:""};
  if(typeof value!=="object"||Array.isArray(value))throw new Error("Invalid debtor review state.");
  const state=value as Partial<DebtorReviewState>;
  if(!state.notes||typeof state.notes!=="object"||Array.isArray(state.notes)||!Array.isArray(state.history)||!["Payment allocation review","Invoice preparation review"].includes(state.mode??"")||typeof state.receipt!=="string")throw new Error("Invalid debtor review state.");
  const allowed=new Set(unitIds),notes:Record<number,string>={};
  for(const [id,note] of Object.entries(state.notes)){
    if(!/^\d+$/.test(id)||!allowed.has(Number(id))||typeof note!=="string"||note.length>20000)throw new Error("Saved account notes do not belong to this block or exceed review limits.");
    notes[Number(id)]=note;
  }
  if(state.history.length>1000||state.receipt.length>1000)throw new Error("Saved debtor review exceeds review limits.");
  const history=state.history.map(item=>{
    if(!item||!allowed.has(item.unitId)||item.deliveryStatus!=="Draft — not sent"||!Array.isArray(item.recipients)||item.recipients.some(email=>typeof email!=="string")||typeof item.subject!=="string"||typeof item.body!=="string"||typeof item.accountNote!=="string"||!item.attachment||item.attachment.mediaType!=="text/plain"||typeof item.attachment.content!=="string"||typeof item.attachment.fileName!=="string")throw new Error("Saved reminder does not belong to this block or has invalid content.");
    return captureReminder(item);
  });
  if(new Set(history.map(item=>item.id)).size!==history.length)throw new Error("Saved reminders contain duplicate request IDs.");
  return {notes,history,mode:state.mode as StandingOrderMode,receipt:state.receipt};
}
/** Server-side validation uses manager-authorized block units, never client unit claims. */
export function validateDebtorState(value:unknown,blockId:number,unitIds:number[],today:string):DebtorReviewState{
  if(!Number.isSafeInteger(blockId)||blockId<=0)throw new Error("A valid authorized block is required.");
  dayNumber(today);
  if(value===null||value===undefined)throw new Error("Debtor review state is required.");
  return readDebtorReviewState(value,unitIds);
}
export function standingOrderAction(mode: StandingOrderMode, recordedPaymentReference: string): string {
  if (mode === "Invoice preparation review") return "Prepare a draft invoice against the lease schedule for manager approval. No charge is posted.";
  return recordedPaymentReference.trim() ? "Review the recorded bank receipt and its unit allocation before posting." : "Await a recorded bank receipt. An expected standing order is not evidence of payment.";
}
