# Client-invoice review corrections — local only

> Historical preparation/review below. The subsequently authorized integrated release and applied migrations are recorded in [london-integrated-rollout.md](london-integrated-rollout.md). Backup/restore and authenticated-testing limitations remain as described there.


This follow-up corrects the independent review of proposal commit `69d3513`. Nothing has been applied to production or deployed. The existing contractor work-order amount release remains separate. No real invoices, financial balances, messages, storage files or Lovemore Park resources were created/changed.

## Corrections

1. **Audit identity sequence:** explicitly revoke ALL on `public.client_invoice_events_id_seq` as well as `private.client_invoice_number_seq` from PUBLIC, anon, authenticated and service_role. Table RLS is not relied on to protect sequence access.
2. **Privileged runtime role:** explicitly revoke all service_role privileges on the new public invoice/audit tables, private configuration, both sequences and all seven new functions. The feature does not use a service-role client. Authenticated user clients retain only scoped SELECT plus the explicitly authorized mutation/authorization functions. Database owners/operators remain privileged. No production-wide default ACL or existing object permission is changed.
3. **Required text:** SQL now rejects noncanonical leading/trailing whitespace using the same 25-character ECMAScript trim set used by TypeScript. Tabs, line breaks, non-breaking space and other trim characters cannot stand in for required issuer/client names/addresses, descriptions or registered VAT number. Optional email validation uses the same whitespace set, including interior non-breaking spaces. The web API still normalizes its inputs before saving; direct RPC callers must submit canonical text. SQL validates again at Review and Issue, before number allocation.
4. **UUID readiness:** SQL now enforces the canonical dashed UUID format accepted by the renderer for invoice, request and line identifiers. PostgreSQL's looser alternative UUID input forms can no longer produce an issued document that the TypeScript/PDF validator rejects.
5. **Master database freeze:** add `writes_enabled=false` beside `issuing_enabled=false`. The mutation capability holds a shared configuration-row lock and requires the master flag for every Save/Review/Issue/Void/replay. A committed disabling update waits for in-flight mutations; subsequent direct RPC writes fail closed. A CHECK constraint disallows issuing_enabled=true while writes_enabled=false. Missing configuration also fails closed.
6. **Migration lock bounds:** the additive transaction sets local lock_timeout=5s and statement_timeout=60s. These are proposed reviewed bounds, not production setting changes made during preparation.

There are still three new tables, two sequences, seven functions, seven indexes and two new SELECT policies. The master gate adds one column and one consistency CHECK on the new private configuration table. Existing rows, policies, grants and ledgers remain untouched; the only migration seed is the new configuration singleton with both flags false.

## Exact activation and rollback behavior

| App environment flag | Database writes | Database issuing | Effect |
| --- | --- | --- | --- |
| Off | Off | Off | UI/API hidden or blocked; every mutating RPC is blocked. Scoped database reads remain authorized by RLS. |
| On | Off | Off | Read-only register/PDF/audit access; all mutations blocked, including direct RPC and repeats. |
| On or off | On | Off | Authorized Save/Review/Void allowed via direct RPC; the app must be on to use its UI/API. Issue is blocked. |
| On or off | On | On | Authorized lifecycle actions, including explicit Issue, allowed via direct RPC; the app flag still governs only its UI/API. |
| Any | Off | On | Invalid configuration; the database CHECK rejects it. |

The application switch `LONDON_CLIENT_INVOICES_ENABLED` is not a database security gate. The two database flags govern direct RPC execution independently of that environment variable. No application role, including service_role, can change the private flags.

After review and separate migration/application approvals:

- Keep both database flags false on installation. Deploy with the application flag off. Enable the app separately for read-only acceptance if desired.
- Authorize draft/review writes explicitly with `update private.client_invoice_configuration set writes_enabled=true, issuing_enabled=false where singleton;`.
- Only after numbering, issuer, VAT and financial policy review, authorize real issuing with `update private.client_invoice_configuration set issuing_enabled=true where singleton;`.
- Freeze/roll back with **one combined statement**: `update private.client_invoice_configuration set writes_enabled=false, issuing_enabled=false where singleton;`. Do not switch off writes alone while Issue is on: the CHECK correctly rejects that invalid combination. Once the combined disabling update commits, no mutation RPC can proceed. Turn off the app flag and restore the previous app if needed; retain all invoice/audit data and counters. Reads are not erased or revoked by the write freeze.

The above are proposed operator steps only. None has been executed on production.

## Tests

`PGLITE_MODULE=/tmp/london-verification/node_modules/@electric-sql/pglite/dist/index.js node tests/run-pglite-client-invoices.mjs` passes with production-style public-schema default privileges recreated before applying the revised proposal to a disposable database. The synthetic service_role has BYPASSRLS so that permission checks cannot pass merely because of RLS.

Verified:

- No USAGE, SELECT or UPDATE on either sequence for anon/authenticated/service_role.
- No SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER on the new tables/configuration for service_role; actual SELECT/DELETE/RPC attempts are denied despite BYPASSRLS.
- No inherited public RPC execution for anon/service_role, empty search paths and SECURITY INVOKER public wrapper.
- Default-off master blocks all four actions before records exist. Enabling Issue without writes fails. A later master freeze blocks all four actions and exact request replay without changing revision, while permitted reads continue. Void remains possible with writes on and issuing off.
- 25 whitespace characters across six required fields and contact emails are rejected consistently; noncanonical line/request UUIDs are rejected.
- Legitimate canonical Western European/multiline content can be saved, reviewed, issued and rendered by the actual PDF implementation.
- Review and Issue independently reject a malformed document injected only by the disposable database owner. Rejected Issue leaves the number sequence unchanged.
- Existing permissions, lifecycle, numbering/replay, eight-digit overflow, stale-revision collisions, exact VAT rounding, future dates, immutable audit/void history and unchanged resident/supplier ledgers still pass.

Final verification: `npm test` passed all 272 tests with zero failures/skips; `npm run typecheck` passed; `npm run build` passed with Next.js 16.4.6. The expanded disposable PostgreSQL test above passed, and `git diff --check` passed. Logs are `/tmp/london-client-invoices-hardened-tests.log`, `/tmp/london-client-invoices-hardened-build.log` and `/tmp/london-client-invoices-hardened-postgres.log`.

## Read-only backup/PITR check and remaining gates

Production project `yhyqxvbquavhndxcwttt` reports ACTIVE_HEALTHY. At **15 November 2026, 02:17 SAST** (00:17 UTC), read-only PostgreSQL statistics reported:

- archive_mode: on; archive_timeout: 2min.
- Last successful WAL archive: **15 November 2026, 02:08:06 SAST** (00:08:06 UTC).
- Reported archive failures: 0; last failed archive: null. The statistics reset timestamp was 25 August 2026, 22:32:01 SAST (20:32:01 UTC); these are observed server counters, not a backup retention certificate.
- No client-invoice objects/configuration have been applied to production.
- service_role does not inherit authenticated or anon in production, so revoking its explicit/default privileges is effective.

The available Supabase connector has no backup-list/PITR-settings operation, and no Management API credential is available in the workspace. I did not extract credentials or attempt an unauthorized dashboard session. The archive statistics do **not** establish a usable base backup, PITR subscription, retained restore window or successful restore test. The latest managed backup and exact earliest/latest recovery points remain unverified. Confirm those read-only in the [London Backups dashboard](https://supabase.com/dashboard/project/yhyqxvbquavhndxcwttt/database/backups) or through the approved read-only Management API before migration approval. [Official backup documentation](https://supabase.com/docs/guides/platform/backups) describes those checks and the distinction between database backups and Storage objects.

Remaining rollout gates: backup/recovery confirmation; review/approval of this corrected SQL and role/gate policy; registering the SQL through the approved migration workflow (the sandbox CLI initialization/download limitations remain); and signed-in acceptance plus a true multi-connection lock/race test in a disposable approved environment. Embedded tests execute revision collisions on one serialized connection and do not claim a multi-connection load test. No known reproduced sequence-grant, service-role or issued-PDF whitespace/UUID defect remains after this correction.

Subsequent unpublished supplier-contact, invoice-type and supply/tax-point validation changes are documented in [client-invoice-legal-fields-update.md](client-invoice-legal-fields-update.md), including the current SQL hash and 277-test results. The object/privilege/gate design here is unchanged.
