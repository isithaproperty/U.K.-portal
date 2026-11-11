# Integrated local safety review

This is a review record, not deployment authorization. No hosted schema, permissions,
storage objects, payment records, email, environment flags or publication were changed.

## Dependency order

Inventory the target database first. These SQL files are one-time proposals; do not
rerun already-installed base scripts or infer the live schema from this checkout.

1. Verify the existing scoped blocks/members/units, service-charge ledger and invoice
   numbering, management review, resident bank reconciliation, cashflow observations,
   canonical supplier settlements, management dispatch, and work-order workflow.
   In particular, the private schema, authenticated schema usage, current Storage
   ownership fields, and work-order approval/payment guards must already be present.
2. Apply the reviewed bulk reminder migration only after management dispatch and its
   ledger/contact dependencies: `supabase/bulk_reminder_dispatch.sql`.
3. Apply `docs/proposed-staff-work-order-documents.sql` after the work-order workflow.
   Review all live Storage policies first, because permissive policies combine and
   an unrelated broad policy could override the intended private bucket boundary.
   The dedicated bucket must remain private; no overwrite/delete permission is added.
4. Apply `docs/proposed-whole-block-reconciliation.sql` after resident reconciliation,
   cashflow, management review, and canonical supplier settlement dependencies.
5. Release the matching application only with its reviewed database changes, or a
   deliberate rollout gate. Do not deploy a UI-only partial feature as working.

Steps 2–4 have no conflicting function/table names and were exercised together in
that order. The test also loads existing contractor work-order Storage policies and
the contractor upload-only restriction before the staff-document proposal.

## Reproducible isolated verification

From the repository root:

`PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node tests/run-pglite-integrated-safety.mjs`

The runner creates and closes a disposable embedded PostgreSQL database, with
synthetic auth claims, records and Storage metadata only. It does not contact hosted
Supabase, create real uploaded files, submit email, or deploy. Six checks cover:

1. Combined migration dependency/order compatibility.
2. Atomic signed-statement staging, observation/receipt deduplication, owner-only
   supplier approval, portfolio scope, mixed rollback, partial/full settlement and replay.
3. An active unit reminder blocks resident posting and rolls back the entire mixed
   supplier/resident approval, including its supplier settlement and payment status.
4. Staff document upload remains independent of ledger revisions, reminder locks and
   payment approval; the assigned contractor can read but cannot approve payments.
5. An expired reminder claim becomes Uncertain, then the mixed approval can commit;
   the resident payment advances the reminder revision without changing the historical
   approved PDF/envelope.
6. Exact replay adds no extra settlement, resident payment or reminder revision.

Also retain the feature-specific runners for broader malformed-input and authorization
coverage: `tests/run-pglite-bulk-reminders.mjs` (13 checks),
`tests/run-pglite-staff-documents.mjs`, and
`tests/run-pglite-contractor-reconciliation.mjs`.

## Approval and verification still required

- Obtain authorization for the exact source publication and schema rollout, including
  the new bucket, table policies, grants and scoped database functions. This local
  review does not grant that authorization.
- Keep both email delivery gates unchanged. Deploying reminder preparation is not
  permission to enable transport, queue live messages, or send them. The independent
  ledger batch-posting flag is also outside this change.
- Verify signed-in scoped staff upload, assigned-contractor read, forbidden reads,
  and mixed reconciliation in a non-production environment before production release.
- PGlite uses one session with mocked auth/Storage. It proves transactional rollback
  and state transitions, not real Storage signature behavior, an authenticated browser
  flow, or a multi-session concurrent/deadlock stress test.
- The canonical supplier settlement bank ID and immutable allocations prevent duplicate
  accounting. Cash observations remain separate from posted receipts/settlements.
  No-ID overlapping exports and changed bank-ID formats still need manual review.
- Staff uploads are supporting documents only. They neither verify an invoice nor
  complete/approve a work order, post a payment, or send a notification.

No blocking cross-migration interaction was found in the tested local paths. Live
policy inspection and the staged end-to-end checks above remain rollout gates.

## Read-only hosted preflight (11 November 2026)

A separate read-only inspection of the London project found Storage RLS enabled,
three existing private buckets, and all existing object policies constrained to their
named buckets. No broad current policy exposes the proposed staff-document bucket.
The new bucket, its helpers and all three proposed feature tables are absent.
Prerequisite Storage owner fields, private-schema access and work-order columns exist.
Recheck this at rollout because live policies may change. No hosted migration,
permission or record was changed during this inspection. Staged signed-in end-to-end
and multi-session concurrency testing remain outstanding.
