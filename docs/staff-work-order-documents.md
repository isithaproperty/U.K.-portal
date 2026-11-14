# Manual staff work-order documents

Available in the London portal. Staff can attach an emailed invoice or completed job card independently from an individual work-order page. No dispatch is required. The work-order number and assigned contractor are shown before submission. Existing contractor submissions and their notifications are unchanged. The contractor detail page displays these additional documents separately.

## Authorization and audit

`docs/proposed-staff-work-order-documents.sql` records the original additive SQL design. The current London production schema was checked read-only and already contains an append-only `staff_work_order_documents` table and a separate private `staff-work-order-documents` bucket. Owners/admins and the building's assigned portfolio manager may upload. Other managers, residents and contractors cannot upload through this new flow. Existing contractor uploads retain their own permissions.

The database verifies the current contractor against the selection rendered to the user, checks that the storage object belongs to the uploader, validates metadata and the exact work-order/document path, and records the authenticated user ID/email and timestamp. Cancelled and unassigned work orders reject new uploads. Current assigned contractors can read their own matching historical contractor snapshot only; changing contractor assignment does not reveal the former contractor's files to the replacement. Staff can read history within their portfolio. There are no new delete, replacement or update permissions.

Accepted files: PDF/JPG/PNG, 1 byte to 10 MB, filename 1–200 characters. Client validation includes file signatures; the bucket and database enforce size/MIME metadata. This is not malware scanning. Files are opened using short-lived signed URLs. Ambiguous upload/record errors stop automatic retries and instruct staff to check saved records and ask an administrator about unlinked storage files. No automatic cleanup deletes are attempted.

Uploading does not send email, approve an invoice, add it to the creditors ledger, reconcile a payment, or change a work order's payment status.

## Original feature verification

- TypeScript check passed.
- Full copied-source unit suite: 224 passed, zero failed.
- `npm run build -- --webpack`: passed with synthetic local Supabase configuration.
- Disposable PGlite SQL test passed: owner/admin/scoped manager inserts; independent invoice/job-card; database audit; denied out-of-portfolio, resident, contractor and anonymous writes; assigned-contractor reads; reassignment isolation and stale contractor rejection; cancelled/unassigned rejection; metadata, owner and path validation; duplicate rejection; no updates/deletes.
- Browser interaction QA not completed: installed Chromium aborts with `socket() failed: Operation not permitted`, including the reviewed escalation. No screenshots or live end-to-end success claimed.

Run SQL test without hosted access:
`PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node tests/run-pglite-staff-documents.mjs`

## Current rollout compatibility

The existing table, private bucket, scoped policies and audit trigger have been verified in London production. The monthly upload UI requires no additional migration or permission change. The original SQL proposal remains a reference used by disposable local regression tests; it is not executed again during this release. The current verification report is in `docs/monthly-invoice-fix-review.md`.

## Ongoing monthly invoices

Ongoing work orders have an explicit **Upload monthly invoices** link in both work-order views. It opens the existing staff attachment section directly. Select up to 12 invoice files per batch, and repeat for later months. PDF/JPG/PNG limits and file signature checks apply to every file before any write. Job cards and one-off order attachments remain single-file uploads. Include the month in each filename; original names are preserved. There is no new invoice-period field.

Each invoice uses a fresh UUID, its own storage object with overwrite disabled, and its own append-only document record. Duplicate original filenames do not replace earlier months. The existing database trigger supplies uploader identity, contractor snapshot and timestamp; RLS and the private bucket continue to enforce portfolio access. No permission, storage policy or database migration is changed.

A batch is deliberately not an all-or-nothing storage transaction. On a partial or uncertain failure it stops, reports the number confirmed saved, refreshes document history and disables further submission in that component until reload and review. No successful file is deleted, and no blind automatic retry is attempted. Administrator review may be needed for an unlinked file after an uncertain record save.

Uploads do not create creditor invoices or payments. Record each invoice number, date and amount separately in Creditors; duplicate supplier invoice numbers and settlement safeguards still apply there. This separation prevents counting attachments as a second cost.

The Actual Amount/Actual cost input and display have been removed from the work-order tab and register. Historical `actual_cost` values and accounting calculations are retained. Explicit job/contract cost approval now lives with the selected work order in Creditors, uses signed-in approval identity and an optimistic timestamp check, and is disabled for settled/paid work. Ongoing contracts remain active across their monthly invoices; one-off jobs still require completion before approval.
