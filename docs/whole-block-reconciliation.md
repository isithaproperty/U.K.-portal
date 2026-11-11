# Whole-block bank reconciliation: review implementation

This change is local source only. No hosted SQL, payment, bank upload, email, deployment or publication was performed.

## Operator flow

1. Choose the block and upload its bank CSV once. Map signed amount OR separate credit/debit columns.
2. The entire signed statement is retained as cashflow observations. Positive receipts also enter the existing resident review queue. This is one atomic database operation.
3. Existing cashflow fingerprints are reused. Cashflow observations do not themselves post resident receipts or supplier payments, and are not added a second time when the same statement was already uploaded through cashflow.
4. Review residents alongside outgoing transactions. Outgoings suggest a supplier invoice only with one exact WO reference within the selected block, a completed and approved work order, matching supplier, saved invoices totalling approved actual cost, and one outstanding invoice. A bank transaction ID is required for this approval path.
5. The owner checks bank evidence, payee and invoice, then approves the selected resident receipts and contractor payments together. The batch either succeeds fully or rolls back. No bank transfer is initiated.
6. Partial settlements remain part paid. Paid is set only by the existing canonical settlement routine after every invoice is settled and the approved cost is covered. Other outgoings remain visibly unmatched.

## Deliberate limits

- Existing owner-only settlement authority is preserved. Managers/admins can review; they cannot gain supplier payment approval through this screen. This needs an explicit policy decision before changing.
- Uploading an invoice/job card alone is not invoice verification, WO completion or payment approval. The separate staff upload feature has no authority to cause settlement.
- Multiple invoice allocations, missing bank IDs, missing/ambiguous WOs, old manual settlements and unapproved jobs stay for manual review. The existing creditor settlement flow can handle reviewed split allocations; this view does not guess.
- Transaction IDs are the strongest duplicate key. No-ID export overlaps and changed bank ID formats still require manual review. This existing fallback limitation is disclosed in the UI.
- The endpoint fails closed if evidence is missing or a result exceeds 1,000 records. A paginated/reviewed extension is needed for larger histories.
- This is not an opening/closing balance certification or an automatic classifier for bank fees/transfers.

## Rollout requirement

Review and install `docs/proposed-whole-block-reconciliation.sql` only after the existing resident reconciliation, cashflow, management review and supplier settlement migrations. Deploy the route/UI only with that migration, or behind a rollout flag. Until then the unified importer reports unavailable rather than silently dropping outgoings. No hosted migration has been run.

## Verification

- Full Node unit suite: 227 tests passed.
- TypeScript: passed.
- Disposable PGlite/PostgreSQL: atomic import, deduplication, mixed approval rollback, owner/portfolio authorization, exact reference boundaries, ambiguous references, overpayment, stale revision, evidence confirmation, partial/full settlement and idempotent replay passed.
- Default Turbopack build cannot resolve the shared node_modules symlink outside this isolated checkout. Alternate Webpack production build passed.
- Browser interaction and live integration have not been validated. No live credentials or data were used.
