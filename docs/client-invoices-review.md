# Management-company client invoices — review before rollout

## Outcome and release boundary

Prepared locally on branch `feature/client-invoices`, based on current main `16225143f4d9e98ded39fe1d2181926a793d5329`. This is a separate sales-invoicing area for the management company to bill clients for management fees or other line items. It does not reuse resident service charges, contractor invoices, bank reconciliation, supplier settlements or their invoice numbers.

**Not pushed or deployed. No production migration, real invoice, invoice number, financial balance, email or Lovemore Park resource was created or changed for this feature.** The independent contractor work-order amount fix was deployed separately in commit `1622514`; it is not part of this pending feature diff.

Production metadata was inspected read-only on the London Supabase project `yhyqxvbquavhndxcwttt`. The required existing `blocks`, `portal_members` and `private` schema are present; no client-invoice tables exist. The new persistence therefore requires the additive SQL in `docs/proposed-client-invoices.sql` before activation. Do not deploy or apply it until reviewed and separately approved.

## User workflow

1. Open **Client invoices**, choose an authorized block, and create a new draft.
2. Configure the issuer name, address, optional company registration/contact details, client name/address/contact details, billing period, invoice/due dates, optional purchase reference, payment instructions and notes.
3. Add up to 50 lines with description, quantity (three decimal places), net unit price in GBP (two decimal places) and explicitly reviewed VAT rate (two decimal places). VAT registration defaults to off. An unregistered issuer cannot charge VAT; enabling registration requires a number before review and does not populate any rate automatically.
4. Save the draft. It has a UUID and revision, **no final invoice number**, and a draft-marked PDF. Incomplete drafts may be saved but cannot be reviewed or issued.
5. An owner or admin explicitly confirms the exact saved revision and reviews it. Saving subsequent edits returns it to Draft and removes the review approval. A scoped manager can prepare drafts but cannot review, issue or void them. Review and issue are role-restricted explicit steps; the same owner/admin may perform both, so a mandatory two-person policy is not enforced.
6. An owner or admin explicitly issues the reviewed revision. A distinct, stable `MCI-00000001`-style number is allocated in the same transaction as the frozen issued record and audit event. Issuing is separately gated off by default in the database. No email, resident charge, supplier payment, account posting or receipt is generated.
7. Issued content cannot be edited. An owner/admin may void an issued invoice with a reason; its number and issued audit snapshot remain. There is no deletion workflow or automatic credit/refund. Download either the current PDF or a historical saved revision, including the original issued revision after voiding.

The register is paginated at 25 invoices; audit history loads 20 revisions at a time with older-history navigation. No list total is presented as an outstanding receivable balance. Delivery and payment receipt status are explicitly untracked.

## Database and permission design

- New `public.client_invoices` stores a frozen block/issuer/client/document snapshot, independently calculated integer-pence totals, lifecycle metadata and revision.
- New `public.client_invoice_events` records every Save/Review/Issue/Void, authenticated actor UUID/email, timestamp, exact request UUID/payload and complete resulting snapshot. Applications have SELECT only on both tables. No direct INSERT, UPDATE or DELETE grant is provided.
- RLS permits owners/admins and the current block's scoped manager to read. Residents, contractors, anonymous users and other portfolio managers cannot read or mutate these records. No public share or email link is created.
- A narrow private, explicitly authorized SECURITY DEFINER capability performs lifecycle writes atomically. Its public RPC wrapper is SECURITY INVOKER. Every function has an empty search path; default PUBLIC/anonymous function execution is revoked. Request actors derive from authenticated JWT identity and `portal_members`, never editable user metadata.
- Invoice row/advisory locks, revision checks and globally unique request UUIDs make retries idempotent and reject conflicting/stale actions. Reusing a request with another payload is rejected. Only Issue can use the new private number sequence; authenticated users cannot allocate numbers directly. Gaps may occur after rolled-back transactions; existing numbers are never reused or renumbered. The implementation handles numbers longer than eight digits without truncation.
- `private.client_invoice_configuration` is installed with `issuing_enabled=false`. It has no application grants. Separately, `LONDON_CLIENT_INVOICES_ENABLED` defaults off; it hides navigation and blocks the APIs before database access. Neither setting is enabled in production by this work.
- The database independently validates issuer/client structure, dates, positive reviewed lines, limits, VAT registration and rates, and rounds net/VAT per line using integer arithmetic. Caller-supplied totals, lifecycle state, number, actor and timestamps cannot be injected. TypeScript performs the same calculations for preview and checks saved totals when building a PDF.
- Issued/voided documents preserve their original data; PDFs are deterministic, inert version-1 output derived from saved snapshots, with a SHA-256 response header. Historical revision links remain available. PDF files are not emailed or stored in a separate bucket by this feature.

## Verification

All records, invoice issues/numbers and role identities in tests are synthetic and exist only inside disposable embedded PostgreSQL or mocked transports.

- `npm test` — 272 tests passed, 0 failed, 0 skipped, including the existing London regressions.
- `npm run typecheck` — passed.
- `npm run build` — passed with Next.js 16.4.6, including the new guarded API routes.
- `node --test tests/client-invoices.test.mjs tests/client-invoices-api.test.mjs tests/client-invoices-ui.test.mjs` — passed 14 targeted tests covering VAT defaults/registration, exact rounding, invalid dates/amounts, confirmations, role/origin gates, PDF structure/draft/issued/void output, escaping and page lengths, default-off activation, request locking, dirty-review invalidation, uncertain outcomes and identical-request retry/history recovery.
- `PGLITE_MODULE=/tmp/london-verification/node_modules/@electric-sql/pglite/dist/index.js node tests/run-pglite-client-invoices.mjs` — passed the proposed SQL in a disposable database. It verified manager/owner/admin/other-manager/resident/contractor/anonymous permissions; denied direct/audit/sequence writes; default-off issuing; save/review/issue/void; stable request replay and invoice numbering; stale/revision-collision denial; immutable issued snapshots; numbering past eight digits; future-date/PDF-character guards; 15 TypeScript/PostgreSQL VAT-rounding comparisons; empty search paths and invoker wrapper; and unchanged resident/supplier ledger counts.
- `git diff --check` — passed.

Logs: `/tmp/london-client-invoices-tests.log` and `/tmp/london-client-invoices-build.log`. UI tests invoke transpiled React handlers with controlled transports; no authenticated live browser or production issuing test was performed. The disposable database has catalog privilege assertions rather than a hosted advisor service.

## Exact proposed rollout steps — separate approval required

1. Review this diff and `docs/proposed-client-invoices.sql`. Confirm the target is the dedicated **London Property Portal** Supabase project `yhyqxvbquavhndxcwttt`, review the current recovery point, existing objects and legal invoicing policy. Do not target Lovemore Park.
2. Register the reviewed SQL as a migration using an approved working Supabase CLI: run `supabase migration new management_client_invoices`, then copy the exact reviewed proposal into the generated file and check its diff. This repository currently keeps earlier reviewed SQL as flat scripts. Do not blindly push or replay historical scripts. No timestamped migration filename was invented here: current CLI binaries cannot initialize their read-only home configuration in this sandbox, and the older CLI download is blocked. The proposal itself was executed successfully in disposable PostgreSQL.
3. After explicit database-change approval, apply **only this additive transaction** through the project's normal reviewed migration process. It creates the two invoice/audit tables, private configuration and sequence, scoped functions/policies and grants, then requests a PostgREST schema-cache reload. It creates no client invoice or financial entry. The script is intentionally one-time and fails if conflicting objects already exist; inspect conflicts rather than rerunning with relaxed guards.
4. Verify the new objects, RLS, function ACLs, empty search paths, private sequence access and empty client-invoice register. Confirm `issuing_enabled=false`. Review Data API exposure of the two public tables and RPC. Keep resident/supplier records untouched.
5. After separate application-release approval, deploy the tested application while `LONDON_CLIENT_INVOICES_ENABLED` is absent/false. Authorize setting it to `true` only after persistence and scoped access checks pass. Keep database issuing off while reviewing real issuer/client settings, VAT policy, payment instructions, authorized approvers and the dedicated MCI number series/start against any external existing invoices.
6. Only after explicit issuing activation approval, execute `update private.client_invoice_configuration set issuing_enabled=true where singleton;` as the approved database operator. Users must still save, review and explicitly issue each invoice. Do not create real test invoices or send email for smoke tests.
7. Verify public login health and authenticated read/permission behavior without writes. If rollback is needed, disable issuing and the application flag, then restore the prior application deployment. Preserve the new tables, audit history and sequence; do not drop, truncate or renumber issued records.

## Risks and limits for review

- A real Issue action creates a finalized outbound invoice record once both gates are intentionally activated. There is no automatic email, payment collection, receipting, debtor balance, ledger integration or recurring billing job.
- The issuer/VAT registration number and rates are explicitly configured, not verified against a tax registry. No VAT registration or standard rate is assumed. GBP only; refunds/credit notes, non-block invoices, tax-return reporting and advanced tax treatments are outside this implementation. Finance should approve numbering, tax treatment and document wording before activation.
- An invoice belongs to one existing block for permission scope. The client is a freeform billing snapshot; it is never inferred from a resident or contractor account. Issuer/client data is copied per invoice, not maintained as a separate shared customer directory.
- The built-in PDF font supports Western European text. Unsupported characters block review/issue rather than producing a corrupt issued document. Version-1 rendering must remain available for historical snapshots. There is no archived external PDF storage or malware/content scanning service.
- Audit data retains client billing/contact details. Application users cannot edit/delete audit rows, but database administrators retain their normal privileged access. Retention/access policy needs the same review as other billing data. Existing block deletion is restricted by the invoice foreign key, preserving records.
- The local tests cover revision-collision attempts on a serialized embedded connection; a multi-connection production load/race test and signed-in browser acceptance remain rollout checks. Uncertain requests are retained for exact retry while the current screen remains open; after leaving/reloading, inspect the saved register/audit history rather than recreating invoices blindly.
