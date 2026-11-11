# Import unit apportionments once

## Workflow

1. In **Units & residents**, select the building and import the resident template with optional `service_charge_percentage`, or its unit export (`Unit Code`, `Unit Name`, `Service Charge (Percentage)`; `ID` and `Unit Description` are ignored). The old four-/five-column resident templates remain valid. A unit-only export creates no resident access.
2. Shares belong to the building's unit, not a resident. Joint residents may repeat the same percentage or leave it blank. Conflicting nonblank values reject the entire import. Blank percentages/references preserve existing values. `0` is an explicit excluded unit, not a blank.
3. Review coverage and total in the register. Partial imports are retained for review, but no budget allocation is available until every registered unit has a share and the total is valid. Correct the register before relying on automation.
4. Drop the building's budget CSV, choose the correct annual column and confirm its start date. Saved unit percentages load automatically and calculate the preview. No second share upload is required. Alternative share files/current schedules affect this preview only, not the stored unit shares.
5. Review the building, annual total and effective shares; apply the preview and explicitly save the budget. No charges, payments, emails, resident deletions or posting settings are changed.

## Matching and rounding

Only trimmed, case-insensitive exact unit labels/code-to-register-label matches are allowed within the selected building. `Flat1`, `Flat 1`, `1`, `1066-01`, and `1066-1` are not assumed equivalent. Source external IDs never select portal IDs. Conflicting code/name matches are rejected. Unknown unit names create units through the existing register workflow, so check the register rather than assuming a source file matches an incomplete test building. Repeated source codes with different names are rejected. Malformed row lengths are rejected, not repaired by shifting cells.

Fourteen source shares of `7.142860000000` total `100.00004%`. Keep those source values. The existing budget reconciler allows only a 0.001 percentage-point discrepancy, produces deterministic four-decimal effective percentages totalling exactly 100%, and visibly requires review. Annual allocations retain every penny. Totals outside that tolerance, missing shares, duplicate mapping and incomplete building coverage block allocation. No equal-split fallback exists.

## Required database change (not applied)

`docs/unit-apportionments-proposal.sql` proposes nullable `units.service_charge_percentage numeric(15,12)` and a new SECURITY INVOKER `import_block_residents_with_shares` RPC. It preserves existing RLS, active/archived resident semantics and references. It does not modify policies, existing units, budgets or ledgers. Review live schema/policies and obtain approval before generating/applying the migration. The proposal passed 40 disposable local PGlite SQL checks with synthetic owner/admin/manager/resident RLS contexts. Deployed policies and schema still need staging verification before approval/rollout.

Share-bearing imports call only the new RPC. If unavailable, they fail with no rows saved rather than silently dropping percentages. No-share imports retain the old RPC. The manager page queries shares separately so missing schema cannot hide the existing register; missing/unreadable share data is treated as unavailable and never as equal shares.

## Verification

`npm test`, `npm run typecheck`, `npm run build`. Focused tests: `tests/resident-import.test.mjs` and `tests/budget-import.test.mjs`. SQL proposal has an explicit staging/RLS/concurrency checklist. `tests/run-pglite-unit-shares.mjs` passed 40 isolated SQL checks. Production database and delivery/posting behavior were not exercised or changed.

## Authorization boundary

The new RPC explicitly requires managers to have an exact, nonblank portfolio assignment matching the building. Null, empty and whitespace-only assignments are rejected even if existing table policies would permit them; owner/admin access remains unchanged. Local tests deliberately retain permissive blank-equality table policies to verify the RPC guard independently.

Hosted read-only review found table-wide authenticated SELECT/INSERT/UPDATE grants and existing blank-portfolio matching policies. The new guard does not fix direct REST or legacy-RPC access under those inherited policies. Remediating existing grants/RLS requires separate scoped approval. No existing policy or live data was changed.
