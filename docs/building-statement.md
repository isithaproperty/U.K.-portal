# Building financial statement (unpublished review)

The corrected requirement is an on-demand building statement, rather than treating the supplied year-end workbook as a resident invoice. The manager sidebar now opens **Building statement**. The earlier budget-import implementation remains in history and in the existing management financial preparation area; no prior work was discarded.

## Report

Select a building and any start/end dates up to today, then Pull statement. The report includes:
- Every work order raised within the date range, with currently recorded status, estimate and actual cost. These costs are not called bank payments; unknown amounts are counted and shown as missing.
- Supplier invoices dated in the period, separately from verified canonical supplier settlements paid in the period.
- Opening and closing supplier debt, including older unpaid invoices.
- Each unit's opening balance, charges, recorded payments, credits, closing balance and overdue amount. Credit balances remain separate from other units' debts.
- Bank receipts, outgoings and net movement imported for that building/date range, explicitly **Unreconciled**. No closing bank balance is invented.
- Downloadable CSV combining the report and bank transaction detail, with spreadsheet-formula protection for text fields.

The report reads fresh building-scoped records through `/api/blocks/[blockId]/statement`. It checks manager access, uses exact-count pagination, rejects incomplete sources and caps each source at 100,000 rows. A missing creditor/settlement source blocks the report; missing or truncated bank data is labeled and blocks full export. It is a management report from current recorded data, not audited accounts or an immutable historical snapshot.

## Bank statement staging

`/api/blocks/[blockId]/cashflow` and `supabase/building_cashflow.sql` add separate signed bank observations. Receipts and outgoing payments are retained; zero rows are skipped. Column mapping and building confirmation are required. Bank transaction IDs are preferred. Without IDs, occurrence fingerprints cannot distinguish every genuinely identical transaction across overlapping exports; the interface warns users to check duplicate counts.

Cashflow reads use paginated exact counts with an explicit 10,000-row report cap. New rows remain Unreconciled. Imports never create resident ledger payments, supplier settlements or communications. Existing reviewed resident-payment reconciliation and owner-confirmed supplier settlement workflows remain the ways to record verified payments. Do not add cashflow observations to ledger figures as if they were additional transactions.

## Activation and verification

No migration has been applied; no live records, emails, pushes or deployments were made. Activation needs the existing review/settlement migrations and the new `building_cashflow.sql`, database verification, browser QA and reviewed deployment. The local environment lacks Postgres/Supabase CLI for disposable migration checks; Chromium cannot create its process socket, so browser testing is blocked. These are unverified stages, not passes.

The combined unit/handler suite has 93 passing tests, including CSV signed amounts, fingerprint handling, statement period boundaries, scope, debt calculations and complete-read handler failures. TypeScript passes. Next.js compilation/static generation succeeds, with a pre-existing dependency-security warning requiring a build retry. Resolve that security warning before treating this as release-ready.

The supplied workbooks have the same four-sheet extracted structure. They are references only, not seeded production records. The corrected unit-share CSV with a malformed four-field row is rejected by the strict share parser; it is not silently repaired and does not block read-only building statements.

## Subsequent verification and isolated preview

Next.js was patched to 16.4.6 and official npm audit reports zero known vulnerabilities. The full 99-test suite, TypeScript and production build pass without the previous security warning. Actual SQL assertions now pass in disposable embedded PostgreSQL (PGlite 0.5.16), including cashflow RLS/duplicates/rollback and existing review, ledger, settlements, dispatch and standing-order suites. Hosted Supabase configuration and real concurrent sessions remain unverified; no hosted migration has been applied.

The review/building-financial-statements preview branch is explicitly isolated: live APIs and mutations are blocked, app pages redirect to /review, and the statement uses fabricated fixtures only. Its bank upload is disabled. The preview demonstrates £200 invoiced, £100 verified supplier settlement, £100 supplier debt, £750 overdue resident balance and separate unreconciled cash observations. This fixture never reads production account data.

## Paid and unpaid columns
Work-order rows show Paid, Unpaid and invoice payment status from linked supplier invoices dated through the statement end and canonical verified settlements through that date. Part payments remain Part paid; work orders without an invoice show Not recorded, not a zero liability. These figures are not the work-order estimate/actual cost, nor proof that all future invoices have arrived. Supplier invoice rows and CSV have matching labels. Team members record actual payments through the existing owner-authorized supplier settlement workflow. Pulling the statement creates no payments or resident charges.
