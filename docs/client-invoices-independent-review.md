# Client-invoice migration — independent rollout review

**Historical review of commit `69d3513`.** The findings below were reproduced against that unchanged proposal. The subsequent local corrections are documented in `docs/client-invoices-hardening.md`; audit/service-role grants and required-text validation are corrected and a master write gate is added. No production migration or deployment has occurred. Keep this original evidence as review history.

Reviewed local proposal commit `69d3513ddee31ff7df4d9082c19897a4be1e4bf0` against read-only metadata and aggregate data from **London Property Portal**, project `yhyqxvbquavhndxcwttt`, PostgreSQL 17.6, region eu-west-2. No migration, deployment, production write or email was performed. The proposal and application implementation were not changed by this review.

## Decision

**Hold rollout and issuing activation.** Schema prerequisites match production and the design is additive, but two reproduced issues need correction before approval: production default grants leave the implicit audit sequence overprivileged, and database required-text validation can finalize an invoice whose PDF cannot render. Also explicitly decide the intended service-role privileges and whether the feature needs a database-wide write kill switch.

The earlier 272-test result remains a valid result for its fixtures, but those fixtures did not include production's public-schema default ACLs or the whitespace-only direct-RPC case. This review added those conditions in a separate disposable test, without editing the proposal.

## Reproduced findings

### 1. Missing revocation on the implicit audit identity sequence

The identity column on `public.client_invoice_events` creates **`public.client_invoice_events_id_seq`** in addition to the explicit private invoice-number sequence. Production's existing default privileges grant ALL on new public sequences to `anon`, `authenticated` and `service_role`. The proposal revokes access to `private.client_invoice_number_seq`, but does not revoke access to the implicit public audit sequence.

Replaying the actual production defaults in disposable PostgreSQL confirmed:

- `has_sequence_privilege('anon','public.client_invoice_events_id_seq','USAGE') = true`.
- `has_sequence_privilege('authenticated','public.client_invoice_events_id_seq','UPDATE') = true`.
- Ordinary authenticated table UPDATE remains denied, so this is not a general invoice-write bypass. Sequence ACLs are separate from table RLS, however, and allow sequence inspection/advancement/reset wherever that role has SQL execution access. I have not established an arbitrary-SQL route for anonymous users through the public REST API.

**Required correction:** explicitly revoke ALL on this identity sequence from PUBLIC, anon and authenticated; review service_role separately. Repeat privilege tests with production-style default table/function/sequence ACLs. See `docs/proposed-client-invoices.sql:21` (identity creation) and `:42` (table-only revocation).

### 2. SQL/TypeScript required-text mismatch can issue an unrenderable invoice

At `docs/proposed-client-invoices.sql:60`, SQL uses `btrim(v)` and checks the untrimmed string's length for required fields. PostgreSQL's default btrim removes spaces, while the TypeScript/PDF validation uses JavaScript trim and rejects whitespace-only required fields.

In disposable PostgreSQL, a direct owner RPC with issuer name consisting only of one tab was accepted through Save, Review and Issue. It received `MCI-00000001`. Calling the actual PDF renderer on that saved issued record then failed with **"Complete the invoice labels within their length limits."** This affects direct RPC callers; the web API's PDF preflight blocks the same input, but the public authenticated RPC must independently preserve the invariant.

**Required correction:** align canonical text/required-field validation across SQL and TypeScript, including tabs, newlines and supported whitespace such as non-breaking space. Add direct-RPC tests proving no invoice number can be committed for a document that fails the renderer's readiness checks. Consider issuer/client names/addresses, descriptions and registered VAT number, rather than only this one example.

### 3. service_role retains default direct writes to the new public tables

Production's existing public-schema defaults grant ALL on new tables to service_role. Because the proposal revokes PUBLIC/anon/authenticated but not service_role, the disposable replay confirmed service_role retains direct UPDATE on invoices and DELETE on audit events. It also retains execute on the new public wrapper and ALL on the public audit sequence.

This does not grant ordinary signed-in users those privileges. It means existing privileged runtime keys are able to bypass the new mutation/audit capability for these tables. **Explicitly accept this privileged-runtime trust boundary or revoke unnecessary service_role DML/sequence grants on the new objects.** The current client-invoice implementation uses authenticated user clients and does not need a service-role write path.

### 4. Application flag is not a database-wide kill switch

`LONDON_CLIENT_INVOICES_ENABLED=false` hides the UI and blocks the application's endpoints. It cannot block direct calls to `public.mutate_client_invoice`. The database configuration flag gates **Issue only**. After the migration, a scoped manager can call the RPC to Save a draft and an owner/admin can Review it even while issuing remains disabled. The disposable replay confirmed both transitions.

Once the database issuing flag is true, an authorized owner/admin may issue via RPC even if the app flag is false. Therefore the two flags are not cumulative database authorization gates. If the intended rollout requires all writes to remain impossible until activation, add and enforce a private master-write gate. Otherwise document and explicitly approve this limited activation behavior. Rollback must disable the database issuing flag; hiding the application alone is insufficient.

## Production compatibility and existing data

- The project reports ACTIVE_HEALTHY. No existing relation or function with a client-invoice name was found, so there are no object-name collisions or old client-invoice rows to migrate.
- Required blocks/portal_members columns and types match. There are 85 blocks, with no blank names, addresses or managers, and no block name/address characters outside the current PDF renderer's supported set.
- The membership table has one owner, one admin and two managers. Aggregate checks found no noncanonical member emails or manager memberships with blank portfolio scope. No resident/client/contact row details were exported for this review.
- The private schema exists. authenticated already has USAGE, but not CREATE; anon has no private-schema USAGE. The proposed USAGE grant therefore repeats an existing effective privilege rather than expanding access on current objects.
- Production public-schema defaults for both postgres and supabase_admin grant broad access to new tables/sequences/functions. Explicit revocations are therefore essential; minimal-default local tests are insufficient.

## Exact objects added

### Tables (3)

- `public.client_invoices`: document/block snapshots, integer-pence totals, lifecycle/revision and approval/issue/void metadata.
- `public.client_invoice_events`: immutable-by-application revision audit, actor UUID/email, exact request identity/payload and resulting snapshot.
- `private.client_invoice_configuration`: one new singleton row, `issuing_enabled=false`.

### Sequences (2)

- `private.client_invoice_number_seq`: explicit MCI issue numbering.
- `public.client_invoice_events_id_seq`: implicit identity sequence for audit row IDs.

### Functions (7)

- `private.client_invoice_can_manage(bigint, boolean)` — SECURITY DEFINER authorization helper.
- `private.client_invoice_keys(jsonb, text[])` — SECURITY INVOKER validation helper.
- `private.client_invoice_pdf_text(text)` — SECURITY INVOKER validation helper.
- `private.client_invoice_label(jsonb, text, integer, boolean, boolean)` — SECURITY INVOKER validation helper.
- `private.validate_client_invoice_document(jsonb, boolean)` — SECURITY INVOKER independent accounting validation.
- `private.mutate_client_invoice(jsonb)` — SECURITY DEFINER narrow mutation capability.
- `public.mutate_client_invoice(jsonb)` — SECURITY INVOKER exposed wrapper.

All seven functions set an empty search path. The definer code authenticates with auth.uid and portal membership, qualifies table/function names and does not use editable user_metadata. The public wrapper itself is not SECURITY DEFINER.

### Indexes (7)

- `public.client_invoices_pkey`.
- `public.client_invoices_invoice_number_key`.
- `public.client_invoice_block_updated_idx`.
- `public.client_invoice_events_pkey`.
- `public.client_invoice_events_request_id_key`.
- `public.client_invoice_events_invoice_id_revision_key`.
- `private.client_invoice_configuration_pkey`.

There are also new-table CHECK constraints and two NO ACTION foreign keys: invoice to existing block, and audit event to invoice. These preserve records and will prevent deleting a block that has invoices, or deleting an invoice that has audit rows. No triggers, storage buckets, cron jobs, email queues or ledger entries are added. No existing-table column or existing policy is modified.

### RLS and intended ordinary-user privileges

RLS is enabled on all three new tables. Two SELECT policies are added on the public tables, allowing owners/admins and the current block's portfolio manager; residents, contractors, anonymous users and other portfolio managers are excluded. The private configuration table has no application policy/grant.

`authenticated` receives SELECT on the two public tables and EXECUTE on the authorization helper, private mutation function and public wrapper. It receives no direct table INSERT/UPDATE/DELETE. PUBLIC/anon execution is explicitly revoked from the new functions. The four validation functions remain owner-only. The private numbering sequence and configuration are explicitly revoked from ordinary roles. Production-inherited audit-sequence and service-role exceptions are the unresolved items above.

## Existing rows, objects and policies

The script does not update, delete, backfill, copy or renumber any existing production row. Its only inserted row is the new disabled private configuration. It does not alter existing RLS policies, default privileges, grants on existing tables, authentication settings, resident accounts, budgets, work orders, supplier invoices, settlements or communications.

Operational effects still require care: the new foreign key must acquire a lock on blocks, and `NOTIFY pgrst,'reload schema'` refreshes the project's API schema cache. The proposal does not set local lock/statement timeouts. The inspection connection currently reports lock_timeout=0 and statement_timeout=2min; the actual migration operator's session may differ. Use reviewed bounded timeouts and a quiet deployment window rather than allowing indefinite lock waits.

## Backup, rollback and activation safeguards

1. **Backup verification remains outstanding.** The exposed tools did not provide the last successful backup/PITR recovery point or a restore test. ACTIVE_HEALTHY and a clean health-advisor result do not establish recoverability. Confirm the current backup timestamp, retention and restore capability in the London project before approval. No backup was created or production clone provisioned during this read-only review.
2. Correct the reproduced issues, retest against production defaults, confirm numbering/issuer/VAT policy and obtain explicit approval for the exact migration. Keep issuing disabled.
3. Apply the additive SQL as one reviewed transaction, with bounded lock/statement timeouts and no blanket replay of earlier scripts. Any migration error before COMMIT rolls back these new objects/configuration. Verify object ACLs, RLS and both sequences afterward, not just table grants.
4. Only after a separate application release approval, deploy with the application flag off. Enable draft/review access with the documented direct-RPC caveat, or enforce a master-write gate first. Enable database Issue only after a further explicit decision on real invoicing and the MCI series/start.
5. For application rollback, disable database issuing first, turn off the UI/API flag, and restore the previous application deployment. Preserve invoice/audit tables, counters and issued records. Do not drop/truncate objects or reset issued numbering. A full database restore would also revert unrelated legitimate work and is a disaster-recovery action, not a routine feature rollback.
6. Same-person owner/admin review and issue is currently permitted. A strict two-person approval policy, archived PDF bytes, payment receipting and automatic sending are not implemented. Preserve version-1 rendering for historical snapshots.

## Other observed production advisories

The current health advisor returned no findings. Security advisor findings predate this unapplied proposal: three informational RLS-enabled/no-policy tables; a warning for the existing public SECURITY DEFINER `read_bulk_reminder_snapshot`; and leaked-password protection disabled. They were not changed during this review and do not describe the new private-definer/invoker-wrapper design.

- [Existing definer-function advisory guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- [Leaked-password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- [RLS-without-policy advisory guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Reproduction evidence

`node /tmp/london-client-invoice-independent-review.mjs` executed the unchanged proposal only inside disposable embedded PostgreSQL, after recreating production-style public table/function/sequence defaults. It reproduced the sequence grants, service-role DML, direct Save/Review with issuing off, and successful SQL Issue followed by failing PDF rendering for a tab-only issuer.

Structured results: `/tmp/london-client-invoice-independent-review.json`. The temporary script and results contain only synthetic invoice identities and local catalog output. All production calls used metadata/aggregate SELECTs or read-only project/advisor tools. Production client-invoice objects were reconfirmed absent at the end of the inspection.
