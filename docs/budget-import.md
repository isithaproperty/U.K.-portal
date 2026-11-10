# Building budget CSV import (review only)

Adds a manager-only **Budget** sidebar entry. Choose a building first, then drop a CSV exported from the budget worksheet. The importer identifies the category header after optional Block Name / From / To metadata and requires an explicit amount-column selection and matching charge-year start date. It previews categories and checks any supplied total against their sum. It does not import invoice or paid-detail tabs. XLSX upload is explicitly rejected with CSV-export guidance.

The team's workbook was inspected through its attachment: Summary has both previous and new-year budget columns; other sheets contain prior budgets and expenditure. No workbook contents, resident details or building data are seeded into this repository.

## Shares and resident population

- Upload that building's Unit Code / Unit Name / Service Charge (Percentage) CSV, or reuse a complete share schedule already loaded for the selected building.
- External source IDs never become database IDs. Unique exact code/name matches suggest assignments; the manager checks all mappings. Every current building unit must be mapped once, including 0% shares for exclusions.
- Decimal percentages up to twelve places are supported. Only a source total within 0.001 percentage points of 100 can be reconciled. The preview shows source total, effective four-decimal shares and penny-exact annual allocations; approval is required.
- Applying changes only the local draft. Replacing a nonempty preparation requires confirmation to avoid summing prior and new years. Same-year reimports are blocked in the current draft and repeated Apply is disabled. Imported schedule and batch identities are stable per building/year, so changed labels do not generate new ledger request IDs; server-side preparation validation enforces this identity. Corrections that conflict with posted request IDs fail rather than duplicate charges. Changing buildings resets the import.
- Save uses the existing building-scoped, revision-checked financial preparation endpoint. The retained preparation stores annual total and unit shares; imported category breakdown is a preview, not a separate persisted expense budget.
- Imported budgets use a single Annual demand schedule; other instalment cadences remain available for manually prepared schedules but are not enabled for CSV imports in this version. Existing Prepare / Save / Post approved batch workflow produces the existing unit service-charge ledger entries. Residents already read their own unit ledger using existing RLS; multiple residents of one unit do not multiply the charge. Uploading or preparing does not post charges or send email.
- Existing review migrations and posting activation remain prerequisites. No migrations, live postings, emails, repository pushes or deployments were performed for this feature.

## Checks

`npm test` passes 80 tests, including five new CSV/rounding groups. `npm run typecheck` and the final `npm run build` both passed (build required retry after its security warning). A browser smoke script is supplied at tests/browser-budget.mjs for local synthetic review on port 3012 and Chromium CDP port 9222; execution here was blocked because Chromium could not create its process socket. Browser visual and interaction verification therefore remains pending. Build tooling warns that the pinned Next.js version has a known security vulnerability; dependency remediation is separate from this change.
