# Portfolio statements and outbound client summary

The manager-only **Statements & summaries** sidebar view offers three separate reports:

1. Resident/unit account statements: all selected accounts, including zero/credit balances, or positive balances including amounts not yet due.
2. Building financial statements: work orders and unbilled commitments, supplier invoices and verified allocations, resident balances and separately labelled imported bank cashflow.
3. Outbound client-invoice summary: saved document rows, with Draft, Reviewed, Issued and Voided totals kept separate. Client invoices also has a View client invoice summary shortcut.

Select all permitted buildings or a subset and a date range, preview complete coverage, then review and download **CSV** or **printable HTML**. Open HTML and use Print/Save as PDF; it is a combined manager-only file and must not be sent to an individual resident/client. Unit statements use portrait A4; financial/client tables use landscape. Empty/nonmatching buildings remain in the coverage index without generating empty document pages. Existing single-building statement/bank tools remain accessible separately.

## Amounts and coverage

The existing tested unit and building calculators are reused. Historical ledger entries before the start date supply opening balances; end-date filtering excludes later ledger movements. Positive balances and credits remain separate. Missing registers/ledger activity are identified, and missing data is not presented as a verified zero financial balance. No missing invoices, opening balances or payments are invented.

Work-order costs/commitments are not payments. Supplier invoice liabilities, canonical verified supplier allocations and staged bank rows remain distinct, with no grand total that double counts them. Ongoing costs are the recorded contract total; there is no automatic annual renewal. The existing statement API now reports whether a supplier register was actually saved, so an absent register is distinguished from evidence of no liabilities.

Client filtering explicitly uses **invoice date** and **current saved revision/status**. It is not a reconstruction of historical issue/void state. Each invoice is counted once, with validated document/totals and unique identity, never once per audit event. Undated and outside-range records are counted in coverage. Draft/Reviewed totals are proposed documents, not issued sales/receivables. Voided amounts have separate totals, excluded from active issued totals. Issued document totals do not establish receipt or debt.

Client **payment status is Not tracked; outstanding is Not available**. No paid/unpaid/overdue client balance is inferred, no issuer/client names are silently merged into account identities, no VAT registration/rate is assumed, and reports never issue an invoice. The HTML summary presents the key register columns; the CSV additionally includes supply date and billing period. Existing application/database issuing gates remain disabled and unchanged by this release.

Every selected building must complete successfully before any download is offered. Pagination, count/duplicate checks, source validation, bank truncation checks and invoice revision rechecks fail closed. Limits are explicit: 200 selected buildings; existing statement source limits of 100,000 rows and bank API's 10,000-row completeness cap; client export 2,500 records per building with 100-row pages and a second ID/revision pass; 6 MB per source response and 20 MB generated HTML+CSV. Large/incomplete selections must be narrowed; no silently partial “all” pack is produced.

Buildings are loaded with at most three concurrent requests. Cancellation, changing controls and scope changes invalidate prior previews and review confirmation; stale responses cannot enable a download. A coverage index identifies building IDs, retrieval times, included counts and missing data. **Reads are separate per building and per source, not a simultaneous portfolio database snapshot.** Counts/revision checks detect known changes but cannot freeze all mutable financial records. Work-order costs/statuses also remain current recorded values. These limits appear in the interface and files. Reproducible simultaneous/historical accounts would require a separately reviewed snapshot capability, not an unlabelled timestamp cutoff.

## Access and database impact

`GET /api/blocks/[blockId]/portfolio-report` accepts kind=units/buildings/client and start/end dates. It authenticates with the caller's existing session, validates dates (no future end date) and enforces owner/admin or a nonblank exactly matching manager portfolio before reading data. It delegates units/buildings to the existing scoped statement GET and, for financial reports, the existing scoped cashflow GET. Client reads use existing invoice RLS with block filtering, immutable-ID ordering, exact counts and revision rechecks. The UI filters the offered building list by the same staff scope. Resident, contractor and foreign-manager requests are denied before statement/invoice loading.

There is **no new database migration, permission, policy, service key, table, queue or saved report**. All required relations already exist in London. The new handler calls no mutation/posting/email RPC. No financial balance, delivery state or invoice lifecycle state is altered. The route is force-dynamic, browser requests use cache:no-store, and responses are private/no-store; each Preview generates fresh retrieval timestamps. HTML is escaped and has restrictive CSP, no scripts/remote content and a sandboxed preview. CSV quotes text, neutralizes spreadsheet formulas and contains one BOM across combined sections.

## Verification

- `npm test`: 304 passed, zero failed/skipped (291 baseline plus 13 report model/API/UI tests).
- `npm run typecheck`: passed.
- `npm run build`: passed with Next 16.4.6; generated next-env.d.ts restored afterward.
- Synthetic model coverage includes building separation, opening/settlement/credit balances, no-data coverage, ongoing contract/invoice/payment/cash separation, proposed/issued/void status totals, unknown client payment state, invalid totals/dates/scopes/duplicates, safe HTML and parseable formula-safe combined CSV.
- API tests cover unauthenticated/resident/contractor/foreign/blank-manager denial, owner/admin reads and an explicit London-assigned manager request for a different building ID denied before any statement/invoice data query, complete multiple pages and revision recheck, partial/oversized/stale sources, bank truncation/failure and date validation.
- UI tests cover three-worker concurrency, completed/reviewed downloads, changing controls, cancellation, failed selections and stale-response suppression. No hosted record was created.
- `node tests/generate-portfolio-report-samples.mjs` writes synthetic HTML/CSV samples under `/tmp/london-portfolio-report-samples`. Chromium rendered the supplied inert HTML, generated PDFs for inspection, and screenshots/text extraction verified building boundaries, readable money values and separate statuses. Synthetic images contain no remote resources. The download product is HTML/CSV, not a newly hosted PDF service.
- `git diff --check`: passed.

Production checks are limited to schema/configuration inspection and unauthenticated health after deployment. No authenticated production export, financial edits, accounts, invoice creation, emails, migrations or Lovemore Park changes are performed for acceptance testing. Deployment source SHA and health are recorded in the handoff.
