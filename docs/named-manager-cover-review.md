# London: named reciprocal manager cover (unpublished proposal)

The standalone test counts below record branch `056f3a9`. For the combined H&S integration, additional sender/audit checks and corrected coordinated rollback, see `safety-manager-cover-integration.md`.

Brian confirmed that Jillian and Ramiro should manage each other's blocks as their own during leave. The tabs select a working portfolio; they do not impersonate the colleague or activate/revoke an entitlement. Both portfolios are authorized continuously after activation. There is no automatic leave schedule or expiry.

## Verified scope, 17 November 2026

London Supabase project `yhyqxvbquavhndxcwttt` (London Property Portal); deployed application baseline `471f09f884903966224744685c06b728196b61d9`. Repository `isithaproperty/U.K.-portal`. This work does not touch Lovemore Park.

- `ramiro@aviaf.co.uk`: role `manager`, home assignment `Ramiro Naidoo`, currently 48 blocks. Adds manager access to `Jillian`, currently 37 blocks.
- `jillian@aviaf.co.uk`: role `manager`, home assignment `Jillian`, currently 37 blocks. Adds manager access to `Ramiro Naidoo`, currently 48 blocks.
- `bobby@aviaf.co.uk`: existing `admin`, all 86 blocks, unchanged. The block labelled `Bobby` is outside both managers' scope.
- All three have Auth accounts. Named membership emails, roles and home assignments were checked read-only. No credentials or Auth histories were exported.
- Other managers keep their existing nonblank exact portfolio match. Having the same portfolio label or setting JWT user metadata does not confer reciprocal cover. Changing either named account's role/home assignment immediately removes its cover at database checks, without token refresh. Changing a block's manager changes scope according to its new label.
- Coverage follows **current portfolio labels**, including future blocks assigned to those labels. It is not a fixed historical list. If a colleague's account is removed, the remaining manager can still cover blocks bearing the relevant label while their own named membership/assignment remains valid.

## Application and operational behavior

`My blocks` and the named colleague's blocks switch the block list and related residents, units, work orders, maintenance requests, safety records, service charges, reports and alerts together. Switching resets open block/review/payment selections, search and child forms. Contractors remain the existing shared contractor register. Bobby gets no restricted portfolio toggle.

All management API membership reads now include the actual signed-in membership email. Shared server checks and both service-role Edge senders use the same named scope rule. Audit/created-by/approved-by fields keep the signed-in actor. No emails were sent during preparation. In production, authorized covered work-order sending and resident communications will become available as normal manager operations, and contractor-expiry notices can include a covering manager whose portfolio has affected work orders.

Manager role restrictions are preserved: no owner-only supplier settlement confirmation, no admin/owner-only client-invoice review/issue/void or manager reassignment. Invoice issuing remains disabled. A new database trigger prevents a direct manager UPDATE moving a block between the two portfolios; the API applies the same restriction. The trigger makes no business-data changes.

## Exact proposed database/security changes

`docs/proposed-named-manager-cover.sql`, generated reproducibly by `node scripts/build-manager-cover-proposal.mjs`:

1. Add `public.manager_portfolio_matches(text,text,text)`, a pure, immutable, invoker comparison helper. It reads no tables and changes no data. Revoke default PUBLIC/anon execute; grant execute only to authenticated/service_role. It is **not** a standalone authorization check: callers continue checking verified membership email and role. Calling it with invented arguments cannot change table access. No private-schema USAGE grant is added to service_role.
2. Amend 42 existing policies on 19 public tables and `storage.objects`. Commands, target roles and existing actor/recipient/integrity requirements stay unchanged; the manager equality comparison becomes the named scope helper. Valid own-portfolio access remains; blank labels are rejected. Independent owner/admin/contractor/resident policies are not rewritten.
3. Replace 18 current function definitions with only their portfolio comparisons changed. Existing security modes, owners, signatures, execution ACLs, actor checks and financial validation remain. This includes standing-order saved approver rechecks, dispatch workers, bulk reminders, contractor expiry notices, resident contact/sign-in access, client draft access, work-order document access, cashflow and bank posting/import scope.
4. Add `private.prevent_manager_block_reassignment()` and a `BEFORE UPDATE OF manager` trigger on `public.blocks`. No direct execution grants. A current manager cannot change this field through covered access; owner/admin rights remain unchanged.

Policy operations affected:

| Object | Existing policy commands whose scope changes |
|---|---|
| bank_contractor_reconciliations | SELECT |
| bank_statement_rows | ALL |
| blocks | SELECT, INSERT, UPDATE |
| building_cashflow_rows | SELECT, INSERT |
| building_safety_records | SELECT, INSERT, UPDATE, DELETE |
| communications | SELECT |
| management_dispatches | SELECT, INSERT |
| management_manager_alerts | SELECT |
| management_review_state | SELECT, INSERT, UPDATE |
| resident_messages | SELECT |
| residents | SELECT, INSERT, UPDATE |
| service_charge_document_settings | ALL |
| service_charge_entries | SELECT, INSERT, UPDATE |
| standing_order_runs | SELECT, INSERT |
| standing_orders | ALL |
| supplier_settlements | SELECT |
| tenant_requests | SELECT, UPDATE |
| units | SELECT, INSERT, UPDATE |
| work_orders | SELECT, INSERT, UPDATE, DELETE |
| storage.objects, building-safety-documents bucket | SELECT, INSERT, DELETE |

`ALL` describes the existing policy command; unchanged table/column privileges and other constraints still limit operations. Additional unchanged policies delegate to the replaced private helpers, covering staff/contractor work-order files, client invoices/events and resident contact history. This does not grant Storage UPDATE/upsert/delete for buckets lacking those rights. Storage canonical paths and existing owner checks are retained.

The exact 42 policy names and 18 function identities/bodies are in `tests/fixtures/manager-cover-production-definitions.json`. Table/column grants were also captured read-only to reproduce production privileges locally. Snapshots contain schema definitions, not resident records, financial transactions, stored files or credentials.

## Separate H&S prerequisite; approval required

The current H&S Storage policies parse `blocks.name` instead of `storage.objects.name`. That existing defect is NOT silently fixed here. Its separate prepared branch is `fix/safety-document-upload`, commit `10e074df4806ff5538eb2b0a8089db80eb837ffd`; Brian has not approved its three production policy corrections.

The cover proposal explicitly expects those three corrected predicates first. It **fails atomically** against the currently broken production predicates, rolling back even its helper creation. `tests/fixtures/manager-cover-after-safety-predicates.json` is the local PostgreSQL-normalized result of applying the separately prepared correction to synthetic schema. The cover SQL changes only the manager comparison in those corrected predicates, keeping the canonical path/bucket requirements. No H&S UI change was copied into this branch.

Therefore, do not apply or deploy either change yet. Root must obtain concrete approval for (a) the separate three-policy H&S correction and (b) this broader named reciprocal scope change, plus app and two Edge-function deployment. The clarified product requirement is not approval to mutate production security settings.

## Verification and limits

- `npm test`: 309 passed, 0 failed. Includes new named-account scope, both tabs, cross-feature prop filtering, form resets, no new approval privileges, covered report APIs and mocked communication sender tests. Mocks never send network email.
- `npm run typecheck`: passed.
- `npm run build`: passed, Next 16 production build. An initial attempt using a node_modules symlink failed Turbopack package resolution; copying the existing pinned dependencies into this worktree resolved it without source/dependency changes.
- `PGLITE_MODULE=/tmp/london-safety-verification/node_modules/@electric-sql/pglite/dist/index.js node tests/run-pglite-manager-cover.mjs`: passed. Uses disposable embedded PostgreSQL, actual captured policy/function definitions and production table/column/function grants; synthetic rows only. Tests both named managers, Bobby global scope, unrelated/lookalike/resident/contractor/missing membership denial, assignment/role revocation, API-bypassing reassignment/escalation denial, client approval denial, contact/sign-in/work-order file scope, owned staff uploads, scheduled claim approver rechecks, H&S prerequisite failure/atomicity, canonical H&S upload/read/delete and rollback scope.
- The fixture recreates relevant schemas/policies/ACLs, not the entire managed Supabase platform. Unchanged admin policy behavior is represented explicitly. It does not emulate Auth session handling, Storage byte transport, provider delivery, managed extensions or concurrent live clients. No authenticated production browser flows were exercised.
- No production SQL writes, migration, push, deployment, live uploads/test records, financial posting or real emails. No tests restore production.

## Rollout/recovery after approval

1. Confirm London project identity and capture fresh definitions/ACLs of all affected policies/functions/trigger state immediately before any approved apply. Preserve the read-only catalog snapshot and source commits. Recheck current schema: guarded SQL rejects reviewed policy/function drift. Use a current logical/managed database recovery point if available; historical visible physical snapshots do not include Storage object bytes and restore has not been tested. No Storage recovery claim is made.
2. Review/apply the separately approved H&S policy correction in its transaction. Validate its exact predicates and preserve its own pre-change definition snapshot. Do not upload a real test document without separate authorization.
3. Re-run local cross-cover integration against any changed definitions. Once finalized, register the approved proposal as a migration using the repository/Supabase workflow; do not invent migration-history entries or apply during review.
4. Apply the cover transaction with 5-second lock and 30-second statement timeouts. No rows, memberships, block assignments, bucket properties, object bytes or financial settings are altered by it. Policy guards include command/roles/predicates; function guards use identity and definition hashes. Existing function ACLs remain through CREATE OR REPLACE.
5. Deploy the reviewed app plus `work-order-workflow` and `resident-communication` Edge functions, including `_shared/manager-cover.ts`. Deploying only the app would leave service-role senders inconsistent. Verify deployment SHAs/health, then use authorized authenticated read-only checks as each relevant role if sessions are available. Never fabricate successful live verification.
6. Emergency cover disable: first restore or disable reciprocal access in BOTH service-role Edge senders (`work-order-workflow` and `resident-communication`), which enforce their own TypeScript scope checks and bypass caller RLS. Replacing the database comparison helper alone does not revoke their cover. Then replace the database helper body with valid, nonblank `p_own=p_target` only, preserving its signature/ACL, and roll back the app. Database policies, RPCs and scheduled rechecks use that helper; already authorized/in-flight requests may still finish. Do not alter real membership labels to simulate revocation.
7. Full definition rollback: `docs/rollback-named-manager-cover.sql` restores captured pre-cover definitions **after the H&S correction**, drops only the added trigger/functions, and preserves business rows. Inspect for intervening changes before running: this rollback file is an exact definition restore, not a merge of concurrent edits. It deliberately retains the separately approved H&S fix. Cover-created financial/documents/audit rows remain and are visible under the restored ordinary scopes. Definition rollback cannot recover missing Storage files or undo already delivered communications/financial actions.

Approval scope for root to present: authorize only these two named manager accounts' mutual manager access to the two current portfolio labels, the specified 42 policy/18 function changes and reassignment guard, and app/two Edge deployments, with owner/admin roles and business records preserved; separately authorize the H&S correction first. No approval has been received to execute that production rollout.
