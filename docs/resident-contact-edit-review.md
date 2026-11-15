# London resident contact editing — prepared, not deployed

Built separately on `fix/resident-contact-edit` from production/main `16225143f4d9e98ded39fe1d2181926a793d5329`. The unpublished client invoicing branch in `/workspace/U.K.-portal` remains at `593267143f76168f88c8cae60e275632d664364b` and is not included.

## Behavior

Existing Units & residents, resident directory and block Residents views gain Edit contact details for active assignments when enabled. Authorized owners/admins and the block's assigned portfolio manager may edit name, contact email and phone. The editor reads the current record and audit history before saving, uses its version for conflict detection, prevents duplicate submissions and requires a fresh read after conflicts, successful saves or uncertain outcomes. Older history is paginated. Archived records require the existing explicit restore workflow first.

`residents.email` currently grants tenant access and identifies assignments during import. Therefore the editor does **not** change that column or any Auth identity. A new `contact_email` holds contact details; until set, the directory displays the existing email. The editor explicitly shows the unchanged portal sign-in email. The new contact email does not automatically alter financial delivery contacts, their permission/consent, communications recipients or existing dispatch snapshots. Those remain separately reviewed workflows. Duplicate contact emails are permitted: updates target resident ID and block ID and never search/upsert/merge by email.

IDs, unit/block ownership, account balances and financial references are preserved by the contact RPC. No emails, financial entries, invitations or test production records are created.

## Required database proposal

`docs/proposed-resident-contact-edit.sql` is an unexecuted transactional SQL proposal, not a registered/applied production migration. It adds:

- `residents.contact_email` nullable text and `contact_version` bigint default 1, plus email-format and positive-version constraints. Existing names/emails/phones/ownership are not backfilled or edited. Existing rows expose default version 1 and null contact email.
- `resident_contact_history`, with UUID key, resident/block foreign keys, unique resident/version, actor/time metadata and before/after snapshots. No sequence is created. No historical audit rows are invented.
- Private `can_manage_resident_contact(bigint)` scope helper, two private trigger functions, and BEFORE/AFTER UPDATE triggers on residents. All future actual resident row changes, including existing import/archive/service writes, advance the version and receive an atomic audit entry. No-op writes retain version. Audit failure aborts the original update.
- Public `update_resident_contact(bigint,bigint,bigint,text,text,text)` RPC. It validates inputs, verifies JWT staff/block scope, locks the row, rejects archived/stale versions, and updates only name/contact_email/phone. It uses the caller's existing resident RLS and table grants.
- History RLS permitting scoped staff reads only; authenticated gets history SELECT and helper/RPC EXECUTE. PUBLIC/anon/authenticated/service_role defaults are explicitly revoked on all new functions/table before narrow grants. Service-role legacy resident updates still fire audit triggers, but that role receives no new direct RPC/history privileges. Trigger execution does not require granting app roles executable trigger functions.

Existing resident rows' financial/contact values, existing RLS policies, existing table privileges and tenant access predicates are unchanged. Existing broader direct UPDATE permissions remain in force: the new RPC is a constrained editing path, not a replacement for the entire legacy resident permissions model. Database administrators can still maintain tables. Audit foreign keys intentionally prevent physical removal of referenced resident/block history; the normal archive workflow continues to work. Future changes to resident columns are captured in snapshots and require privacy review.

The proposal uses a five-second lock timeout and 60-second statement timeout. ALTER TABLE and trigger creation require locks. The transaction aborts on conflicts/failures and must be reviewed against a fresh production schema and existing migration registry immediately before any separately authorized application. Do not blindly rerun a partially modified proposal or suppress errors.

## Activation and recovery

A migration is required, so **nothing was pushed, applied or deployed**. To roll out after review:

1. Verify the exact London project/ref and backup recoverability, including independent Storage object protection and an isolated restore drill. See `london-recovery-review.md`.
2. Register the reviewed proposal as an additive migration using a working project CLI/migration workflow; reconcile the migration registry first. Test on a production-like disposable database/staging environment and review existing resident write integrations. The local SQL tests do not substitute for staging/restore verification.
3. Keep `LONDON_RESIDENT_CONTACT_EDIT_ENABLED` unset/false; apply only the approved migration to London, then verify objects/ACLs/constraints and old import/archive paths in staging. No production synthetic resident writes are authorized.
4. Deploy this resident branch independently of client invoicing. Enable the server environment flag only after migration and authorization checks; redeploy for the flag change. Inspect authenticated staff/resident access with authorized accounts, without changing live records, then monitor normal usage.

The app flag disables these editor/API paths; it is **not a database-wide kill switch**. The scoped RPC is directly callable by authorized authenticated staff once its migration exists, even with the app flag off. For a database emergency freeze of this *new* RPC, a separately authorized operator must revoke its EXECUTE from authenticated. That does not freeze existing direct resident writes. Prefer an application rollback plus privilege freeze while retaining columns, version triggers and audit history. Do not drop populated audit/contact data for rollback. Uninstalling schema after any writes needs an explicit preservation/export and dependency plan; no destructive down migration is included.

## Verification

- `npm test`: 263 passed, 0 failed (258 existing + 5 contact validation/API/UI behavior tests).
- `npm run typecheck`: passed.
- `npm run build`: passed with Next 16.4.6; compiled production routes including the new contact API. Generated `next-env.d.ts` restored to its repository version afterward.
- `PGLITE_MODULE=/tmp/london-verification/node_modules/@electric-sql/pglite/dist/index.js node tests/run-pglite-resident-contact-edit.mjs`: passed. Disposable PostgreSQL exercises production-style permissive default ACLs, owner/admin/assigned-manager mutation, foreign manager/blank manager/resident/contractor/anon/service RPC denial, scoped history, protected audit DML, legacy service/archive auditing, required validation, stale versions/no-ops, duplicate contact identities, unchanged sign-in access/ledger and rollback when audit fails.
- `git diff --check`: passed.
- Read-only London production catalog check, 15 November 2026: eight legacy resident columns, no user resident triggers, no contact history/RPC; existing tenant predicate uses `email` with archived exclusion. Confirms the migration blocker.
- Vercel production is READY on `16225143f4d9e98ded39fe1d2181926a793d5329`; the production login page returned HTTP 200. This verifies existing unauthenticated health, not the unpublished editing feature or an authenticated end-to-end production save.

No live resident edits, financial records, emails, production migrations or Lovemore Park changes occurred. Remaining limits: real Supabase/PostgREST staging verification, human review of contact-vs-sign-in semantics and audit retention, verified London recovery window/Storage recovery, migration registration/application and separately authorized deployment.
