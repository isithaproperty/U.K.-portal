# Resident account sign-in display — prepared, not deployed

> Historical preparation/review below. The subsequently authorized integrated release and applied migrations are recorded in [london-integrated-rollout.md](london-integrated-rollout.md). Backup/restore and authenticated-testing limitations remain as described there.


Independent branch `feature/resident-last-sign-in` starts from current production/main `16225143f4d9e98ded39fe1d2181926a793d5329`. The unpublished resident contact editor (`fix/resident-contact-edit`, `a760db6`) and client invoices (`feature/client-invoices`, `68e0fe5`) remain preserved in their separate clean worktrees. This feature does not include their migrations. Integration into the same resident views needs an explicit reviewed merge, preserving their added fields and flags.

## What the timestamp means

[Supabase documents `auth.users.last_sign_in_at`](https://supabase.com/docs/guides/auth/users) as the existing account's last sign-in time. The portal currently uses `signInWithPassword`; its proxy performs `getClaims`, which can refresh existing sessions. We do not reinterpret refresh or page activity as a new login.

Reviewed upstream [Auth token handling](https://github.com/supabase/auth/blob/master/internal/api/token.go), [token service](https://github.com/supabase/auth/blob/master/internal/tokens/service.go) and [verification](https://github.com/supabase/auth/blob/master/internal/api/verify.go): initial token issuance sets `LastSignInAt`; refresh grants use separate refresh/session paths. Verification/recovery can also issue an authenticated session, so the account timestamp does **not** prove an ordinary password login or a visit to `/tenant`. The hosted Auth build was not changed or exercised with a real login to test that behavior.

The feature is therefore labelled **Last account sign-in (may include recovery)**, with explanatory text that it does not show portal visits or session refresh. It displays existing provider metadata rather than claiming to introduce exact portal-visit history. If a strict ordinary-login-only or portal-visit audit is required, that is not presently available: it needs separately designed and authorized future event tracking. No historic events are fabricated from other dates.

Existing sign-in email, not the unpublished new contact email, links an assignment to Auth. Multiple assignments sharing an account show the same account timestamp; it can predate an assignment. This is not proof of which physical person used a shared account.

## UI and data states

Staff see the status beneath the resident name in Units & residents, the directory and block Residents views. Dates use explicit Europe/London time, including GMT/BST. Statuses are:

- Existing active nonanonymous Auth account and recorded timestamp: show that timestamp.
- Exactly one such account with null timestamp: **Never recorded** (for this current account, not a lifetime claim about a person).
- No matching active account: **Not available — no linked sign-in account**.
- Duplicate/ambiguous matches, invalid/future timestamps, read failure, missing response, or missing migration: **Not available**. No error is turned into “never.”

The manager-only server page performs one narrow RPC per visible block when `LONDON_RESIDENT_SIGN_INS_ENABLED=true`. It also filters returned IDs against that block's loaded residents. Existing resident views work without the flag/migration. The tenant page does not fetch or serialize these fields, and the UI defaults to hidden. The feature adds no client Auth admin call, broad user-directory lookup, service-role key or new API route. Supabase's existing self-service Auth API can already expose a user's own metadata; this work does not change that existing behavior.

## Proposed migration and permissions

`docs/proposed-resident-sign-ins.sql` is an unexecuted transactional SQL proposal. SHA256: `5f078a576082bee8d868b93deb6023d12786fe4721f06e0742b3fab190c4054e`.

It creates only two read functions:

1. Private `read_resident_account_sign_ins(bigint)`, SECURITY DEFINER, empty search path, checks nonnull authenticated UID and current portal membership against the requested block. Owner/admin may read their selected blocks; manager requires a nonblank portfolio exactly matching the block manager. It then joins that block's residents to existing Auth users, excluding deleted and anonymous accounts, and returns only resident ID, timestamp and state. It returns no Auth UUID, email, IP, metadata or session data. It uses a set-based join and grouping rather than one admin request per resident.
2. Public same-name SECURITY INVOKER wrapper, empty search path, invoking the scoped private function.

Default EXECUTE is explicitly revoked from PUBLIC/anon/authenticated/service_role on both functions, then granted only to authenticated. The private scope check independently denies resident/contractor/foreign-manager callers, including callers who invoke the private function directly. Authenticated gets private-schema USAGE; that schema already exists and is already used by other approved capabilities. No SELECT on Auth tables is granted. Existing service-role bypass privileges elsewhere are unchanged; this feature grants that role nothing.

There are no new tables, sequences, triggers, indexes, Auth-schema changes, existing policy replacements, resident/login edits, historical backfills or financial effects. The migration performs no application-row INSERT/UPDATE/DELETE. A normal scoped member session suffices at runtime; installation requires the reviewed migration to be run by an authorized database owner with Auth read access. Register it through the project's working migration workflow before application; this document is not migration authorization.

The app flag is a UI/query gate, not a database-wide freeze: authorized staff can call the scoped read RPC after installation even while the app flag is off. To withdraw the capability, separately revoke authenticated EXECUTE on both functions, or remove the public wrapper then private helper after dependency review. Do not revoke private-schema USAGE globally; other features use it. No data restore or deletion is necessary to roll back these read functions. Neither function has been applied.

## Read-only production findings

London ref `yhyqxvbquavhndxcwttt` was inspected on 15 November 2026. Required Auth columns `email`, `last_sign_in_at`, `deleted_at`, `is_anonymous` and the private schema exist; neither proposed function exists. There are no user Auth-history triggers. `auth.audit_log_entries` currently contains no rows, so it supplies no retained event history here. Absence of retained audit rows does not establish that nobody ever signed in.

Aggregate-only identity check found 14 resident assignments and zero matching Auth accounts. No individual Auth email, UUID, password hash, token or resident timestamp was downloaded. Current residents would consequently show the no-linked-account state. No accounts were created or invited to populate the display.

Security advisors returned existing unrelated findings: [RLS enabled without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) on three service tables, the existing [authenticated public definer capability](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) for bulk reminder snapshots, and [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). These were not modified by this task. No new production objects exist to audit yet.

## Local verification and rollout limits

- `npm test`: 262 passed, zero failed/skipped (258 baseline plus four status/visibility/timezone tests).
- `npm run typecheck`: passed.
- `npm run build`: passed with Next 16.4.6. Generated `next-env.d.ts` restored afterward.
- `PGLITE_MODULE=/tmp/london-verification/node_modules/@electric-sql/pglite/dist/index.js node tests/run-pglite-resident-sign-ins.mjs`: passed. Production-style function defaults; owner/admin/assigned-manager scope; tenant/contractor/foreign/blank-manager/anonymous/service and direct-helper denial; no direct Auth reads or raw identifiers; case-insensitive identity mapping; null/no-account/ambiguous/deleted/anonymous/future/infinite states; unchanged Auth rows after reads; simulated activity/refresh timestamps do not change the returned sign-in; later Auth sign-in metadata is read without backfilling anything.
- `git diff --check`: passed.

The disposable test does not run the hosted GoTrue service, prove an authenticated production browser flow, or establish portal-only event history. Nothing was pushed, deployed, migrated, emailed or changed in live data or Lovemore Park. Migration approval and staged Supabase/PostgREST verification are required before activation. Keep the flag off during installation/initial validation, confirm runtime staff/resident access with separately authorized accounts, and preserve the precise account-sign-in wording.
