# London Property Portal review branch

This branch contains real portal components, manager/block-scoped persistence routes, a review SQL script and an opt-in bulk ledger path. Production has not changed. Email delivery and background jobs remain disconnected. This is a partial implementation of the full requested checklist, not a production-ready completion claim.

## Verified target

Vercel project `london-property-portal` (`prj_QM08jiHyUkUS6BJTAHbX4Fl7RXl0`) production deployment `dpl_6vwmhJ8yN3mUPKbAM8hGHAKA6Udm` reports GitHub repository `isithaproperty/U.K.-portal`, repository ID `1344380361`, branch `main`, commit `c2d74ffd34bffec8c4bc2d28c93a4067f3174860`. The saved checkout exactly matched that commit before these changes. Domain: `london-property-portal.vercel.app`. The similarly named `isithaproperty/uk-portal` was not used or changed.

Review branch: `review/london-management-adjustments`. Original source instructions: README and existing SQL scripts. Running Next created AGENTS.md with its version-specific documentation instructions; route-handler documentation was checked.

## Review entry points

Authenticated managers have **Management review** in the existing sidebar. It receives existing scoped units, residents, ledger entries and work orders. It uses explicit Save buttons; failed loads or revision conflicts prevent overwriting records. Saved history is append-only for authenticated users. Existing residents are not assumed to be leaseholders.

A separate synthetic preview is enabled only in development:

```sh
LONDON_REVIEW_MODE=1 npm run dev -- --hostname 127.0.0.1 --port 3010
```

Open `http://127.0.0.1:3010/review`. That route uses fabricated `example.invalid` records and suppresses all persistence/posting requests. It returns 404 in production even with the preview flag set. The preview does not bypass authentication on the real portal.

Screenshots: [Financial allocation](review-financials.png), [mobile debtor view](review-mobile.png), [authenticated persistence against local mock](review-persistence.png).

## Requested feature matrix

“Implemented” below describes branch code, with migration/deployment still required. “Partial” identifies a remaining user workflow connection.

| Requested item | Baseline evidence | Branch outcome and remaining gap |
|---|---|---|
| Budget per lease schedule and charge leaseholders | No budget/schedule model in `ServiceChargeRegister` | Implemented saved named schedules, explicit percentages, penny reconciliation and bulk charge conversion. Opt-in posting API uses the existing atomic importer; disabled by default. No spreadsheet budget import. |
| Bulk demands | CSV bulk ledger import and printable account statement existed; no demand dispatch | Partial: saved bulk demand allocations, separate dates, single-recipient delivery adapter contract. Demand document production, durable dispatch outbox/provider connection and actual sending remain disconnected. |
| Annual / half-yearly / quarterly / English quarter frequency | No cadence model | Implemented period selection and annual instalment allocation, including March 25, June 24, September 29 and December 25. Lease confirmation required; no recurring job activated. |
| Bulk surplus credit notes | Credit entry/CSV import existed | Implemented whole-surplus schedule apportionment and opt-in idempotent ledger conversion. Credit-note document generation/delivery remains disconnected. |
| Prepare ahead / future issue / future due date | Existing ledger entry date and due date, future entries excluded from posted balance | Implemented separate preparation, planned issue, period and due dates with issue-now or schedule-later options. Future ledger rows supported by existing ledger. Scheduled delivery worker remains missing. |
| Multiple leaseholder emails | Multiple resident rows per unit, one email each; no verified contact role | Implemented saved multi-email contact records with explicit leaseholder/tenant/association role and recipient previews. Existing resident login records unchanged. New contacts are not yet consumed by the existing resident-communication Edge Function. |
| Tenant block communications | Existing generic resident block mail and resident dashboard copies | Partial: role-separated contact recipient selection implemented; tenants excluded from financial envelopes. Existing sender/dashboard bridge to new contact records remains to connect. |
| Section 20 initiation / intention / estimates to all | Missing | Partial: saved unsent notices at intention or estimates/proposals stage; explicit route/applicability and captured recipient list. Service evidence/manual review supported. Legally reviewed notice templates, postal/non-email service, complete recipient/service validation and dispatch remain unconnected. |
| Section 20 notification after 30 days | Missing | Internal manager review date implemented from manually reviewed basis after service confirmation. No automatic stage transition/send. Background notification delivery remains disabled. |
| Demand sent date | Ledger has no sent metadata | Missing operationally: UI honestly says delivery history is unavailable. Delivery adapter distinguishes provider acceptance, delivery and uncertainty; no historical dates invented. Needs durable dispatch event storage/provider webhook connection. |
| First reminders | Missing | Partial: first-reminder composition, exact email/document snapshot, account note and persisted draft history. Sending remains disconnected. |
| Final reminder with email and document copy | Missing | Partial: final-reminder composition, persisted exact text attachment/email snapshot and export. Actual sent history remains unconnected. |
| Aged analysis | Account balance and overdue aggregate only | Implemented per-unit not overdue / 1–30 / 31–60 / 61–90 / 91+ buckets and export, matching existing oldest-due-first payment/credit settlement. |
| Last payment received | Payments in ledger | Implemented latest posted actual payment date/reference/amount. Future expected payments are excluded. |
| Standing order automatically adds invoice | Existing bank CSV exact-reference staging and confirmed allocation | Partial: configurable invoice-preparation or payment-allocation review. No receipt inferred from expectation. Automated invoice or bank-feed behavior awaits clarification and connection. |
| Notes carry through | No debtor account-note field | Implemented saved manager account notes carried into reminder review history, excluded from resident attachment. |
| Duplicate WO detection | No duplicate warning | Implemented possible duplicate groups by block/unit/supplier/normalized title. Recurring jobs may match; no automatic deletion. |
| Invoice linked to WO | Existing submission → dispatch → WO document link in `work_order_workflow.sql` | Existing document link preserved. Implemented saved supplier invoice amount/date/reference linked to assigned WO with duplicate invoice validation. Existing uploaded documents not automatically imported into this new register. |
| Paid highlighting | Existing WO owner “Mark paid” toggle | Implemented separate invoice Unpaid / Part paid / Paid derived from recorded allocation evidence. Existing WO status remains unchanged; external supplier-bank settlement and status synchronization remain unconnected. |

## Persistence and approval boundaries

`/api/blocks/[blockId]/management-review/[area]` loads/saves financials, leaseholders, debtors and creditors. It verifies the current user, manager role and exact portfolio assignment, validates all referenced units/work orders and uses a compare-and-swap revision RPC. Unknown areas, malformed content, foreign units and stale saves reject. Responses are non-cacheable.

`supabase/management_review.sql` is a reviewable additive schema script, following this repository’s existing SQL-script workflow. It creates manager-only state/history tables, RLS, append-only audit snapshots, revision guards and a locked financial posting wrapper. It uses invoker permissions and explicitly revokes anonymous access. No live database was contacted or migrated. Supabase CLI attempts could not generate a migration in this sandbox (CLI 3 tried writing read-only `/home/agent/.supabase`; CLI 2 installation failed). The SQL was instead executed and tested directly in a disposable local Postgres container; live Supabase advisor checks were not run.

Apply all prerequisite existing London schema/ledger migrations, including `automatic_invoice_numbers.sql`, before applying this script to a reviewed non-production database. Inspect its policies there before activation. It is not automatically applied by this app.

`/api/blocks/[blockId]/financial-batches` defaults to 503. `LONDON_LEDGER_BATCHES_ENABLED=1` is a separate explicit activation. The manager UI also requires a saved batch and a confirmation describing real ledger charges/credits. The RPC locks that exact saved revision and batch before using `import_service_charges`; stable request UUIDs prevent duplicate retries. No email is sent by posting. No live financial posting occurred during this task.

## Verification evidence

- `npm test`: **40 passed**, including existing authentication redirect regressions.
- `npm run typecheck`: passed.
- `npm run build`: passed with new routes present.
- `git diff --check`: passed.
- Disposable Postgres 17: RLS allowed scoped manager/owner; denied tenant, other manager and anon; immutable audit; optimistic conflicts; actual existing ledger importer plus locked saved batch wrapper; identical replay created one charge and retained future due date.
- Actual Next routes through local mocked Supabase transport: 401/403 permission checks, area validation, load/save/reload, 409 conflict, cross-unit rejection, approval gate, stable ledger replay; passed. The transport is synthetic in-memory test infrastructure, not a real Supabase deployment.
- Chromium desktop/mobile: demand totals/future due date, aged account, repeated reminder capture, state retained between review tabs, tenant demand exclusion, supplier partial/full allocations and unsent Section 20 draft; passed with zero runtime exceptions and zero finance API requests in synthetic mode.
- Chromium authenticated portal + actual Next persistence routes + local mock: saved note survived full browser reload, multiple email contact save; passed with zero runtime exceptions.
- Production-mode `/review`: 404. Default-disabled batch POST: 503.
- Not run: live Supabase migration/advisors; production authentication/RLS regression against real accounts; provider delivery, webhook/outbox recovery, live bank reconciliation, real financial posting or background jobs. No push, merge or deployment performed.

The browser harness initially needed fixes to wait for hydration/dynamic component rendering and document navigation; these were test synchronization failures. Final runs passed. Existing dashboard logo emitted its pre-existing CSS aspect-ratio warning; no browser runtime exception remained.

## Local integration test setup

For API/browser persistence checks, use only the fake transport and explicit fake configuration below. Do not reuse these values in a deployment.

```sh
node tests/helpers/mock-supabase.mjs
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:5440 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=local-test-public-key LONDON_LEDGER_BATCHES_ENABLED=1 LONDON_REVIEW_MODE=1 npm run dev -- --hostname 127.0.0.1 --port 3010
node tests/management-review-api.mjs
chromium --headless --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=9222 --user-data-dir=/tmp/london-review-chromium about:blank
node tests/browser-persistence.mjs
node tests/browser-review.mjs
```

Browser scripts write the evidence screenshots to `docs/`. The API test seeds the fake saved financial budget used by the persistence browser test. The synthetic browser test calls no management API. Browser scripts require Node 24 and a CDP-enabled Chromium.

For SQL checks, use an **empty disposable Postgres database only**: bootstrap `tests/sql/management-review-bootstrap.sql`; apply `supabase/management_review.sql`; run `tests/sql/management-review-assertions.sql`. Then apply `tests/sql/management-financial-bootstrap.sql`, `supabase/service_charges.sql` and `supabase/automatic_invoice_numbers.sql`; run `tests/sql/management-financial-assertions.sql`. None of these fixture bootstrap files belongs in a live database.

Section 20 reference sources consulted: [England 2003 consultation regulations](https://www.legislation.gov.uk/uksi/2003/1987/pdfs/uksi_20031987_en.pdf), [LEASE guidance](https://www.lease-advice.org/costs-and-charges/section-20-consultation/responding-to-section-20-consultation/). Application records do not establish legal compliance or authorize service.
