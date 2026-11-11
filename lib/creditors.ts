import type { WorkOrder } from "../app/types";

export type SupplierInvoice = {
  id: string;
  workOrderId: number;
  contractorId: number;
  number: string;
  amountPence: number;
  invoiceDate: string;
  dueDate: string;
};
export type SupplierPayment = {
  id: string;
  invoiceId: string;
  amountPence: number;
  paymentDate: string;
  bankReference: string;
};
export function normalizeCreditorText(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
export function duplicateWorkOrders(orders: WorkOrder[]) {
  const groups = new Map<string, WorkOrder[]>();
  for (const order of orders) {
    const title = normalizeCreditorText(order.title);
    if (!title) continue;
    const contractor = order.contractorId ? `id:${order.contractorId}` : normalizeCreditorText(order.contractor || "");
    const key = JSON.stringify([order.blockId, order.unitId, contractor, title]);
    groups.set(key, [...(groups.get(key) || []), order]);
  }
  return [...groups.values()].filter(group => group.length > 1);
}
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function poundsToPence(value: string) {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(value.trim())) throw new Error("Enter a positive amount with at most two decimal places.");
  const [pounds, fraction = ""] = value.trim().split(".");
  const pence = Number(pounds) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(pence) || pence <= 0) throw new Error("Amount must be positive.");
  return pence;
}
export function addSupplierInvoice(current: SupplierInvoice[], invoice: SupplierInvoice, orders: WorkOrder[]) {
  if (!invoice.id.trim()) throw new Error("Missing request identifier.");
  const existingRequest = current.find(item => item.id === invoice.id);
  if (existingRequest) {
    if (JSON.stringify(existingRequest) !== JSON.stringify(invoice)) throw new Error("Request identifier already belongs to a different invoice.");
    return current;
  }
  const order = orders.find(item => item.id === invoice.workOrderId);
  if (!order || order.contractorId !== invoice.contractorId) throw new Error("Choose a work order assigned to this supplier.");
  if (!invoice.number.trim() || invoice.number.length > 100 || !normalizeCreditorText(invoice.number)) throw new Error("Enter a supplier invoice number.");
  if (!Number.isSafeInteger(invoice.amountPence) || invoice.amountPence <= 0) throw new Error("Invoice amount must be positive whole pence.");
  if (!validDate(invoice.invoiceDate) || !validDate(invoice.dueDate) || invoice.dueDate < invoice.invoiceDate) throw new Error("Enter valid invoice and due dates in order.");
  if (current.some(item => item.contractorId === invoice.contractorId && normalizeCreditorText(item.number) === normalizeCreditorText(invoice.number))) throw new Error("This supplier invoice number is already in the draft register.");
  return [...current, invoice];
}
export function supplierInvoiceBalance(invoice: SupplierInvoice, payments: SupplierPayment[], today: string) {
  const eligible = payments.filter(payment => payment.invoiceId === invoice.id && payment.paymentDate <= today);
  const paidPence = eligible.reduce((total, payment) => total + payment.amountPence, 0);
  const outstandingPence = Math.max(0, invoice.amountPence - paidPence);
  return { paidPence, outstandingPence, status: outstandingPence === 0 ? "Paid" : paidPence > 0 ? "Part paid" : "Unpaid" } as const;
}
export function addSupplierPayment(current: SupplierPayment[], payment: SupplierPayment, invoices: SupplierInvoice[], today: string) {
  if (!payment.id.trim()) throw new Error("Missing request identifier.");
  const existingRequest = current.find(item => item.id === payment.id);
  if (existingRequest) {
    if (JSON.stringify(existingRequest) !== JSON.stringify(payment)) throw new Error("Request identifier already belongs to a different payment.");
    return current;
  }
  const invoice = invoices.find(item => item.id === payment.invoiceId);
  if (!invoice) throw new Error("Choose an invoice first.");
  if (!Number.isSafeInteger(payment.amountPence) || payment.amountPence <= 0) throw new Error("Payment must be positive whole pence.");
  if (!validDate(payment.paymentDate) || payment.paymentDate > today) throw new Error("Only an actual payment on or before today can be recorded.");
  if (!payment.bankReference.trim() || payment.bankReference.length > 200) throw new Error("Enter the recorded bank transaction reference.");
  if (current.some(item => normalizeCreditorText(item.bankReference) === normalizeCreditorText(payment.bankReference) && item.invoiceId === payment.invoiceId)) throw new Error("This bank transaction has already been allocated to this invoice.");
  if (payment.amountPence > supplierInvoiceBalance(invoice, current, today).outstandingPence) throw new Error("Allocation exceeds the invoice's outstanding amount.");
  return [...current, payment];
}

export type CreditorState = { invoices: SupplierInvoice[]; payments: SupplierPayment[] };
/** Validate untrusted persisted input against work orders already scoped by server authorization. */
export function validateCreditorState(input: unknown, orders: WorkOrder[], blockId: number, today: string): CreditorState {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid creditor register.");
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.invoices) || !Array.isArray(raw.payments) || raw.invoices.length > 1000 || raw.payments.length > 5000) throw new Error("Invalid or oversized creditor register.");
  const scoped = orders.filter(order => order.blockId === blockId);
  let invoices: SupplierInvoice[] = [];
  let payments: SupplierPayment[] = [];
  const strings = (value: unknown, fields: string[]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid creditor entry.");
    const record = value as Record<string, unknown>;
    if (fields.some(field => typeof record[field] !== "string" || (record[field] as string).length > 200)) throw new Error("Invalid creditor text fields.");
    return record;
  };
  for (const item of raw.invoices) {
    const record = strings(item, ["id", "number", "invoiceDate", "dueDate"]);
    if (!Number.isSafeInteger(record.workOrderId) || !Number.isSafeInteger(record.contractorId)) throw new Error("Invalid work order or supplier identifier.");
    const invoice: SupplierInvoice = { id: record.id as string, number: record.number as string, invoiceDate: record.invoiceDate as string, dueDate: record.dueDate as string, workOrderId: record.workOrderId as number, contractorId: record.contractorId as number, amountPence: record.amountPence as number };
    if (invoices.some(existing => existing.id === invoice.id)) throw new Error("Duplicate invoice identifier.");
    invoices = addSupplierInvoice(invoices, invoice, scoped);
  }
  for (const item of raw.payments) {
    const record = strings(item, ["id", "invoiceId", "paymentDate", "bankReference"]);
    const payment: SupplierPayment = { id: record.id as string, invoiceId: record.invoiceId as string, paymentDate: record.paymentDate as string, bankReference: record.bankReference as string, amountPence: record.amountPence as number };
    if (payments.some(existing => existing.id === payment.id)) throw new Error("Duplicate payment identifier.");
    payments = addSupplierPayment(payments, payment, invoices, today);
  }
  return { invoices, payments };
}
