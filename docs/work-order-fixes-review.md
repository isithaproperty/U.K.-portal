# Work-order financials and payment workflow review

Prepared locally on 14 November 2026 in `/workspace/U.K.-portal`, branch `fix/work-order-financials`, based on freshly fetched `origin/main` at `2fac1344a991078988040963779908cf9cd6daf1`. The other workspace repository was not edited. No repository-specific `.agents/skills` directory exists; root AGENTS.md and the installed Next.js client-component guide were read.

## Result

- A block’s manager dashboard now has Financials, opening the statement with that block selected.
- Building statements, their CSV export and budget comparisons show unbilled work-order commitments. Known actual cost takes precedence over the estimate. Invoices reduce the remaining commitment exactly once; verified payments remain separate cash spend. Unknown costs remain visibly unknown. Active earlier-period contracts carry forward, cancelled/future orders do not, and ongoing contract totals do not renew automatically each year.
- The status dropdown offers `Paid — record payment…` for one-off jobs and `Record invoice payment…` for ongoing work. Both open the correct block’s Creditors workflow with the work order selected. Invoice choices identify their work order. Block cards also show payment approval status and a View invoice payments action.
- Existing owner-only, evidence-backed, idempotent settlement logic remains authoritative. A one-off work order becomes Paid when the approved cost matches fully settled saved invoices. Ongoing orders remain active with per-invoice payment status until explicitly closed.

## Verification

All checks used synthetic inputs or disposable embedded PostgreSQL. No live accounts were used.

| Command | Result |
| --- | --- |
| `npm ci --cache /tmp/london-npm-cache --no-audit --no-fund` | Passed; installed exact lockfile dependencies. Default npm cache was unavailable, so a temporary writable cache was used. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed with Next.js 16.4.6, compiled and generated all 14 static pages. |
| `npm test` | Passed: 245 tests, 0 failed, 0 skipped. |
| `node --test tests/work-order-commitments.test.mjs tests/work-order-payment-ui.test.mjs` | Passed: 9 tests covering unpaid commitments, invoice/payment transitions, full and partial settlement, monthly recurring invoices, date/block isolation, unknown costs, dropdown callbacks without direct payment mutation and scoped block Financials navigation. |
| `PGLITE_MODULE=/tmp/london-verification/node_modules/@electric-sql/pglite/dist/index.js node tests/run-pglite-ongoing-work-orders.mjs` | Passed: ordinary settlement regressions; owner-only payment; immutable work type; monthly invoices; partial settlement; replay; no auto-close; explicit close and reopening guards. |
| `PGLITE_MODULE=/tmp/london-verification/node_modules/@electric-sql/pglite/dist/index.js node tests/run-pglite-budget-spend.mjs` | Passed: review/settlement regression SQL; budget scope; role isolation; revision collisions; immutable audit; payload limits. |
| `git diff --check` | Passed. |

`/tmp/london-tests.log`, `/tmp/london-targeted-tests.log` and `/tmp/london-build.log` retain test/build output. The temporary verification packages were installed outside the repository; no dependency or lockfile changes are included. Next.js's generated next-env change was removed from the implementation diff.

## Review limits

A read-only production metadata check on 15 November 2026 confirmed the London Supabase project has the required work-order, review-state and settlement fields, both work-order guards, budget-spend review support and RLS. The Vercel project and linked Git repository were verified. An authenticated production browser flow has not been tested. These fixes add no SQL or production migrations. UI verification invoked transpiled React component handlers with synthetic dependencies; it was not an end-to-end browser run. Work-order costs and status remain current values rather than historical snapshots. Annual renewals require explicit contract records rather than an inferred forecast.

The initial preparation performed no push or deployment. The owner subsequently authorized committing and deploying these fixes if no migration was required. No production database mutation, live test data, email or Lovemore Park action is part of this release.
