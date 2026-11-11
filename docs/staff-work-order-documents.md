# Manual staff work-order documents

Prepared locally, not deployed. Staff can attach an emailed invoice or completed job card independently from an individual work-order page. No dispatch is required. The work-order number and assigned contractor are shown before submission. Existing contractor submissions and their notifications are unchanged. The contractor detail page displays these additional documents separately.

## Authorization and audit

`docs/proposed-staff-work-order-documents.sql` is an additive, transactional SQL proposal, not an applied migration. It creates an append-only `staff_work_order_documents` table and a separate private `staff-work-order-documents` bucket. Owners/admins and the building's assigned portfolio manager may upload. Other managers, residents and contractors cannot upload through this new flow. Existing contractor uploads retain their own permissions.

The database verifies the current contractor against the selection rendered to the user, checks that the storage object belongs to the uploader, validates metadata and the exact work-order/document path, and records the authenticated user ID/email and timestamp. Cancelled and unassigned work orders reject new uploads. Current assigned contractors can read their own matching historical contractor snapshot only; changing contractor assignment does not reveal the former contractor's files to the replacement. Staff can read history within their portfolio. There are no new delete, replacement or update permissions.

Accepted files: PDF/JPG/PNG, 1 byte to 10 MB, filename 1–200 characters. Client validation includes file signatures; the bucket and database enforce size/MIME metadata. This is not malware scanning. Files are opened using short-lived signed URLs. Ambiguous upload/record errors stop automatic retries and instruct staff to check saved records and ask an administrator about unlinked storage files. No automatic cleanup deletes are attempted.

Uploading does not send email, approve an invoice, add it to the creditors ledger, reconcile a payment, or change a work order's payment status.

## Verification

- TypeScript check passed.
- Full copied-source unit suite: 224 passed, zero failed.
- `npm run build -- --webpack`: passed with synthetic local Supabase configuration.
- Disposable PGlite SQL test passed: owner/admin/scoped manager inserts; independent invoice/job-card; database audit; denied out-of-portfolio, resident, contractor and anonymous writes; assigned-contractor reads; reassignment isolation and stale contractor rejection; cancelled/unassigned rejection; metadata, owner and path validation; duplicate rejection; no updates/deletes.
- Browser interaction QA not completed: installed Chromium aborts with `socket() failed: Operation not permitted`, including the reviewed escalation. No screenshots or live end-to-end success claimed.

Run SQL test without hosted access:
`PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node tests/run-pglite-staff-documents.mjs`

## Rollout gate

Before any publication: obtain required deployment/security-change approval; inspect live storage policies for unexpected broad grants (policies combine permissively); review the private functions and bucket configuration; generate the approved migration through the project's supported migration process; apply the SQL and matching UI together; verify signed-in scoped staff upload and contractor read on a non-production environment. Do not deploy only the UI: a missing table is surfaced as an error and uploads are disabled.

The SQL is intentionally a one-time review proposal, not a rerunnable production script. Keep it pending until rollout is approved. No production schema, permissions, files, work orders, email or payments were changed by preparing this feature.
