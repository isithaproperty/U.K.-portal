import { contactRecipients, type ContactDraft } from "./leaseholder-planning.ts";

/** Disabled transport contract only. Nothing in this module sends email. */
export type ManagementMessageKind = "Demand" | "First reminder" | "Final reminder" | "Section20";
export type AttachmentSnapshot = { fileName: string; mediaType: "text/plain" | "application/pdf"; encoding: "utf8" | "base64"; content: string };
export type DeliveryEnvelope = {
  idempotencyKey: string; operationId: string; kind: ManagementMessageKind;
  blockId: number; unitId: number | null; to: string;
  subject: string; body: string; attachments: readonly Readonly<AttachmentSnapshot>[];
};
export type DeliveryAttempt = {
  envelope: Readonly<DeliveryEnvelope>;
  status: "Pending" | "Sending" | "Sent" | "Failed" | "Uncertain";
  attemptCount: number;
  updatedAt: string;
  providerMessageId: string | null;
  submissionEvidence: string | null;
  deliveryEvidence: "Not established" | "Provider accepted" | "Delivered" | "Bounced";
  deliveredAt: string | null;
  history: readonly { at: string; event: string; evidence: string | null }[];
};
export type PrepareDeliveryInput = {
  operationId: string; kind: ManagementMessageKind; blockId: number; unitId?: number | null;
  subject: string; body: string; attachments: AttachmentSnapshot[]; contacts: ContactDraft[];
};
function requiredText(value: string, label: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} is missing or too long.`);
}
function timestamp(value: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19))) throw new Error("A valid UTC timestamp is required.");
}
async function digest(value: string) {
  const buffer = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}
/** One address per envelope. Financial contents must be scoped to exactly one unit. */
export async function prepareDeliveryEnvelopes(input: PrepareDeliveryInput): Promise<Readonly<DeliveryEnvelope>[]> {
  if (!["Demand", "First reminder", "Final reminder", "Section20"].includes(input.kind)) throw new Error("Unsupported message kind.");
  requiredText(input.operationId, "Operation identifier", 100);
  requiredText(input.subject, "Subject", 1000);
  requiredText(input.body, "Message", 100000);
  if (/[\r\n\u0000]/.test(input.subject)) throw new Error("Subject must not contain header control characters.");
  if (!Number.isSafeInteger(input.blockId) || input.blockId <= 0) throw new Error("A scoped block is required.");
  const financial = input.kind !== "Section20";
  if ((financial || input.unitId != null) && (!Number.isSafeInteger(input.unitId) || (input.unitId as number) <= 0)) throw new Error("Financial messages require one scoped unit.");
  if (!Array.isArray(input.attachments) || input.attachments.length === 0 || input.attachments.length > 10) throw new Error("Capture 1–10 exact attachment snapshots.");
  let totalBytes = 0;
  const attachments = input.attachments.map(attachment => {
    if (!attachment || typeof attachment !== "object") throw new Error("Invalid attachment snapshot.");
    requiredText(attachment.fileName, "Attachment filename", 250);
    requiredText(attachment.content, "Attachment content", 3_000_000);
    if (/[\r\n\u0000/\\]/.test(attachment.fileName)) throw new Error("Attachment filename must be a simple safe filename.");
    if (!["text/plain", "application/pdf"].includes(attachment.mediaType) || !["utf8", "base64"].includes(attachment.encoding)) throw new Error("Unsupported attachment representation.");
    if (attachment.mediaType === "application/pdf" && attachment.encoding !== "base64") throw new Error("PDF attachments require captured base64 bytes.");
    if (attachment.encoding === "base64" && (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(attachment.content))) throw new Error("Invalid attachment base64 content.");
    totalBytes += new TextEncoder().encode(attachment.content).byteLength;
    return Object.freeze({ fileName: attachment.fileName, mediaType: attachment.mediaType, encoding: attachment.encoding, content: attachment.content });
  });
  if (totalBytes > 3_000_000) throw new Error("Attachment snapshots exceed the batch size limit.");
  if (!Array.isArray(input.contacts) || input.contacts.length > 1000) throw new Error("Invalid contact register.");
  const scopedContacts = input.contacts.filter(contact => contact.blockId === input.blockId && (input.unitId == null || contact.unitId === input.unitId));
  const recipients = contactRecipients(scopedContacts, input.blockId, financial ? "Demand" : "Section 20");
  if (!recipients.length) throw new Error("No eligible leaseholder or association recipients for this message.");
  const immutableAttachments = Object.freeze(attachments);
  return Promise.all(recipients.map(async recipient => {
    const snapshot = { operationId: input.operationId, kind: input.kind, blockId: input.blockId, unitId: input.unitId ?? null, to: recipient.email, subject: input.subject, body: input.body, attachments: immutableAttachments };
    // Stable ordered serialization binds the key to recipient AND exact document/email bytes.
    return Object.freeze({ ...snapshot, idempotencyKey: `mgmt-v1-${await digest(JSON.stringify(snapshot))}` });
  }));
}
export function pendingDelivery(envelope: Readonly<DeliveryEnvelope>, at: string): DeliveryAttempt {
  timestamp(at);
  return { envelope, status: "Pending", attemptCount: 0, updatedAt: at, providerMessageId: null, submissionEvidence: null, deliveryEvidence: "Not established", deliveredAt: null, history: [{ at, event: "Prepared", evidence: null }] };
}
export type DeliveryEvent =
  | { type: "Start"; at: string }
  | { type: "ProviderAccepted" | "ReconcileAccepted"; at: string; providerMessageId: string; evidence: string }
  | { type: "ProviderRejected" | "ReconcileNotAccepted"; at: string; evidence: string; knownNotAccepted: true }
  | { type: "OutcomeUnknown"; at: string; evidence: string }
  | { type: "RetryFailed"; at: string }
  | { type: "Delivered" | "Bounced"; at: string; providerMessageId: string; evidence: string };
/** A timeout/crash is Uncertain; only authoritative reconciliation can release it. */
export function transitionDelivery(current: DeliveryAttempt, event: DeliveryEvent): DeliveryAttempt {
  timestamp(event.at);
  if (Date.parse(event.at) < Date.parse(current.updatedAt)) throw new Error("Delivery events must be recorded in chronological order.");
  const next: DeliveryAttempt = { ...current, updatedAt: event.at, history: [...current.history, { at: event.at, event: event.type, evidence: "evidence" in event ? event.evidence : null }] };
  if ("evidence" in event) requiredText(event.evidence, "Provider or reconciliation evidence", 5000);
  if ("providerMessageId" in event) requiredText(event.providerMessageId, "Provider message identifier", 500);
  switch (event.type) {
    case "Start":
      if (current.status !== "Pending") throw new Error("Only pending messages may start; uncertain sends require reconciliation.");
      return { ...next, status: "Sending", attemptCount: current.attemptCount + 1 };
    case "ProviderAccepted":
      if (current.status !== "Sending") throw new Error("Provider acceptance requires an active submission.");
      return { ...next, status: "Sent", providerMessageId: event.providerMessageId, submissionEvidence: event.evidence, deliveryEvidence: "Provider accepted" };
    case "ProviderRejected":
      if (current.status !== "Sending" || event.knownNotAccepted !== true) throw new Error("Definitive rejection must establish that the provider did not accept this submission.");
      return { ...next, status: "Failed", submissionEvidence: event.evidence };
    case "OutcomeUnknown":
      if (current.status !== "Sending") throw new Error("Only an in-flight submission can have an unknown outcome.");
      return { ...next, status: "Uncertain", submissionEvidence: event.evidence };
    case "ReconcileAccepted":
      if (current.status !== "Uncertain") throw new Error("Reconciliation requires an uncertain submission.");
      return { ...next, status: "Sent", providerMessageId: event.providerMessageId, submissionEvidence: event.evidence, deliveryEvidence: "Provider accepted" };
    case "ReconcileNotAccepted":
      if (current.status !== "Uncertain" || event.knownNotAccepted !== true) throw new Error("Release of an uncertain send requires authoritative non-acceptance evidence.");
      return { ...next, status: "Failed", submissionEvidence: event.evidence };
    case "RetryFailed":
      if (current.status !== "Failed") throw new Error("Only definitively failed messages can be queued again.");
      return { ...next, status: "Pending" };
    case "Delivered":
    case "Bounced":
      if (current.status !== "Sent" || current.providerMessageId !== event.providerMessageId || current.deliveryEvidence !== "Provider accepted") throw new Error("Delivery evidence must match the accepted provider message and not replace a final delivery event.");
      return { ...next, deliveryEvidence: event.type === "Delivered" ? "Delivered" : "Bounced", deliveredAt: event.type === "Delivered" ? event.at : null };
    default: throw new Error("Unsupported delivery transition.");
  }
}
