# Monthly invoice uploads and work-order amount UI

Based on current main `6ca4f3cbe7063bc5199ccf927c51f71f25e33a14`. Scoped to the London portal only.

The existing schema already accepts repeated staff invoice attachments for one ongoing order. The previous staff screen accepted one file at a time and was reached through a generic document link. This change adds a named monthly upload link and batch selection of up to 12 invoices. Files are validated before writing, saved sequentially with independent UUIDs and immutable storage paths, and audited by the existing database trigger. Later batches append more invoices. Partial failures retain confirmed history, stop further writes and require review before retrying. Contractor submissions retain their separate existing permissions and invoice/job-card flow.

Actual Amount controls and displays are removed from the two work-order views. Historical costs and financial calculations remain. Explicit cost approval moves to Creditors so removing the old input cannot strand new orders without an approval path. Approval records the authenticated email, scopes the update to the block/order and loaded timestamp, checks the returned row and never asserts Paid. Settled costs remain protected by UI and database controls.

## Production compatibility, read-only

London Supabase project `yhyqxvbquavhndxcwttt` was confirmed. Metadata checks confirmed the staff document table and private bucket, individual document UUID/path constraints, no per-order invoice uniqueness limit, enabled RLS, audit attribution trigger, scoped insert/read policies and no authenticated update/delete privilege. Both the production path constraint and storage guard were evaluated against two fabricated monthly invoice path strings: both accepted the paths. No records or storage objects were created by those checks. No database migration or data deletion is required.

## Verification

- `npm test`: 254 tests passed; zero failed or skipped.
- `npm run typecheck`: passed.
- `npm run build`: passed with Next.js 16.4.6.
- `node --test tests/monthly-invoice-uploads.test.mjs tests/work-order-cost-approval.test.mjs tests/staff-work-order-documents.test.mjs tests/work-order-payment-ui.test.mjs`: covered independent monthly attachment writes, same-name preservation, 12-file limit, full validation before storage writes, partial storage/metadata failures, UI double submission, uncertain-outcome lockout, missing history, ineligible users, hidden Actual Amount controls, explicit cost approval and stale-row rejection.
- `PGLITE_MODULE=/tmp/london-verification/node_modules/@electric-sql/pglite/dist/index.js node tests/run-pglite-staff-documents.mjs`: passed 12 monthly invoices on one ongoing order with distinct paths, audit identity, assigned-contractor reads and unchanged lifecycle, plus all existing authorization/immutability/metadata regressions.
- `PGLITE_MODULE=/tmp/london-verification/node_modules/@electric-sql/pglite/dist/index.js node tests/run-pglite-ongoing-work-orders.mjs`: passed ordinary/ongoing settlement, owner-only payment, monthly and partial settlement, replay, no automatic closure, explicit close and reopening guards.
- `git diff --check`: passed.

No real financial records, storage uploads or emails are used for verification. React event handlers are tested with synthetic transports; no signed-in live upload or end-to-end browser success is claimed. Attachments remain independent of reviewed invoice amounts. There is no automatic invoice extraction, malware scan or new invoice-period column. No production migration, permission change, deletion or Lovemore Park action is part of this release.
