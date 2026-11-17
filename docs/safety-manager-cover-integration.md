# Combined London safety-upload and manager-cover review

**Local only. Both production security approvals remain pending.**

Integration worktree: `/workspace/london-safety-cover-integration`, branch `review/safety-manager-cover`. Started at H&S commit `10e074df4806ff5538eb2b0a8089db80eb837ffd`; cherry-picked manager cover `056f3a974140700c7309279a420d95a81042b825` as `036672c`. Both original branches/commits are preserved. The cherry-pick had no conflicts.

## Integrated behavior and additional corrections

The BSC upload save-form/validation/error-handling fix now coexists with My blocks / colleague blocks navigation. Related data and reports switch together; open forms and selections reset. Covered safety uploads retain the selected block prefix and actual actor email. No live uploads or records were created.

Jillian (`jillian@aviaf.co.uk`, manager, home label `Jillian`) and Ramiro (`ramiro@aviaf.co.uk`, manager, home label `Ramiro Naidoo`) have reciprocal manager scope. This is continuous authorization, **not leave-date-gated**. Tabs only select the working portfolio. Future blocks carrying either current matching label follow the same scope. An unrelated manager with the same home label does not gain reciprocal cover. Role/home-assignment changes revoke that account's cover at current authorization checks. Removal of the colleague's account alone does not remove the remaining manager's access to blocks still bearing the covered label.

Bobby (`bobby@aviaf.co.uk`) retains his existing administrator scope across all blocks, including the separate Bobby-labelled block. Neither manager gains administrator or owner powers; Bobby gains no owner powers. Existing permitted manager edits, financial operations, communications and deletions extend to covered blocks, subject to existing validations/constraints. Supplier-payment confirmation remains owner-only; client invoice review/issue/void remains owner/admin-only; issuing remains disabled; block reassignment remains owner/admin-only.

Two source refinements were needed during integration, with no additional SQL permission changes:

- Contractor-upload notification recipients previously still used home-portfolio equality. The existing work-order Edge function now uses the same named scope helper for manager recipients. Thus both current named managers can receive affected upload notifications, continuously, without adding unrelated managers to the opposite portfolio. Normal deduplication remains.
- New work-order dispatch snapshots include `dispatchRequestedBy` from the authenticated caller. The original `issuedBy` remains the original work-order issuer. Existing sent snapshots are not backfilled; this does not claim retroactive sender history. Resident contact audit and resident communication `sent_by` also retain the actual actor.

## Combined checks, 17 November 2026

| Check | Result |
|---|---|
| `npm test` | **323 passed, 0 failed** |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, Next 16 production build |
| `tests/run-pglite-safety-storage-scope.mjs` | Passed; original SQLSTATE 22P02/name-shadowing and numeric-name cross-scope defect reproduced, then corrected path/role/bucket boundaries verified |
| `tests/run-pglite-manager-cover.mjs` | Passed; exact combined H&S-then-cover proposal and rollback tested with captured production table/column/function privileges |
| `tests/run-pglite-integrated-safety.mjs` | Passed, six existing financial/document integration checks |

Run each database script with `PGLITE_MODULE=/tmp/london-safety-verification/node_modules/@electric-sql/pglite/dist/index.js node <script>`. PGlite 0.3.14 is installed outside the repository; no dependency/lockfile changes were made. All databases/records/auth claims/file metadata are disposable synthetic fixtures; email transports are inert mocks.

The earlier **311** H&S tests and **309** cover tests were results from separate branches sharing the 304-test baseline. The combined initial suite passed 316; seven additional integration tests bring the final combined result to 323. These totals are not added together.

Additional integrated assertions cover:

- Both named accounts, lookalikes, unrelated/resident/contractor/missing membership, forged user metadata, current role/home revocation, future matching blocks and Bobby's unchanged global scope.
- Owned staff work-order Storage uploads/read access; canonical safety uploads/read/delete; foreign-block insert/delete denial; permitted synthetic covered work-order/safety-record deletion and continued denial of resident deletion. Existing MIME/size/upsert constraints remain.
- Actual covered contact RPC updates with actor email and distinct synthetic Auth IDs; resident login email, unit/block ownership retained. New dispatch requester metadata and original issuer both retained; communication delivery records retain signed-in sender identity.
- Actual owner-only supplier-payment and bank contractor-approval RPC denial for covered managers; supplier-payment denial for Bobby as admin; client approval gate stays denied for managers.
- Scheduled dispatch claims accept a current covered approving manager, then reject/mark the queued request Failed after that approver loses scope. No sender or external transport runs in the PostgreSQL harness.
- Cover transaction rejects absent H&S prerequisite atomically. The test applies the **actual integrated** `supabase/building_safety_storage_scope.sql`, asserts it matches the reviewed prerequisite, then applies the cover proposal.
- SQL rollback returns managers to own-portfolio scope while preserving the corrected H&S policy, future block rows, contact audit rows, charge rows and Storage metadata.
- Both service-role Edge senders are tested against their pre-cover source to verify that a separate Edge rollback denies reciprocal sending. Current sender tests validate covered access and unrelated/revoked-account denial before any mocked transport.

## Limits

This is not an authenticated production browser test or a managed Supabase staging deployment. The captured-column fixture reproduces relevant schema names, reviewed policies, functions and grants, but not every production default, constraint, trigger, extension or platform behavior. Unchanged admin policies are explicitly represented. Some function bodies use deferred PostgreSQL resolution; installing all 18 definitions does not mean every business branch/RPC was exercised. Existing separate financial integration checks complement, but do not replace, a complete managed-platform staging test.

Edge tests transpile and execute actual TypeScript source with mocked Auth/database/provider adapters; they do not constitute a deployed Deno-runtime or real provider-delivery test. Storage tests validate authorization and synthetic metadata, not managed Storage byte transfer/recovery. No live session refresh, concurrent live-client race, real financial transaction, authenticated production export/upload or email delivery was tested. Fresh production schema compatibility and exact deployed release/health remain rollout-time checks after approval.

## Unchanged approval scope and order

London Supabase `yhyqxvbquavhndxcwttt` only; application `https://london-property-portal.vercel.app`. No Lovemore Park changes.

1. Obtain explicit approval for the separate **three H&S Storage SELECT/INSERT/DELETE policy corrections** and for reciprocal full manager scope for the **two named memberships/portfolio labels**, including existing permitted financial operations, communications and deletion rights. Preserve owner/admin boundaries and existing business records.
2. Obtain approval for cover's **42 existing policy amendments on 19 public tables plus Storage**, **18 function replacements**, pure comparison helper and reassignment guard/trigger. The H&S policies are three of those 42 distinct policies: there are 45 sequential policy alterations, not 45 different policies. Commands/target roles, existing table/column grants and financial constraints are preserved. The pure helper gets authenticated/service_role execution; no private-schema USAGE expansion is added.
3. Capture current affected definitions/ACLs and verify London project identity and fresh compatibility/recovery prerequisites. Historical physical backups exclude Storage bytes; neither a current complete recovery point nor a tested restore is established by these local tests. Definition snapshots are not backups of business rows or files.
4. Apply the approved H&S correction first. Apply the guarded cover transaction second; stop on drift rather than bypassing a failed guard. No deployment script changes memberships, assignments, existing financial rows, bucket properties or file contents.
5. Deploy this combined reviewed application plus both `work-order-workflow` and `resident-communication` Edge functions with `_shared/manager-cover.ts`. Keep client invoice issuing disabled. Verify exact commits/deployments, health and authorized read-only role checks where sessions are available. Do not create live test records or send real emails to claim verification.

## Coordinated rollback

**A database-only cover freeze does not revoke the service-role Edge senders' independent TypeScript authorization.** First restore/disable reciprocal access in BOTH Edge senders, then restrict the database helper to the ordinary nonblank own-portfolio match and restore the app. In-flight requests already authorized may still finish; delivered communications and completed financial actions are not undone by a permission rollback. This limitation was corrected in `named-manager-cover-review.md`.

For full definition rollback, inspect for intervening changes, then use `docs/rollback-named-manager-cover.sql`. It restores pre-cover definitions **after** the H&S correction, removes only the added helper/guard, and preserves business/file metadata. It intentionally retains the H&S path correction; restoring the original broken predicates would reintroduce upload failure and the latent cross-block defect. The H&S UI can be reverted independently if needed; no object deletion/restore is part of rollback.

No push, deployment, production DDL/DML, permission change, real membership edit, production test record, real file upload or external email was performed. No production tool denied an action; work is intentionally local because both security approvals remain pending.
