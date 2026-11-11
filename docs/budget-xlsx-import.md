# Local Excel budget import

The budget chooser accepts CSV and .xlsx. Excel import requires explicit worksheet selection, then annual amount column selection and a confirmed start date. No first sheet or year is selected automatically. Existing category total, complete unit-share, mapping, rounding, lease review and explicit save controls remain. Import never posts charges.

Files are read in browser memory only. The original file is not stored, sent or attached to service charge demands. Reviewing one worksheet is not approval to share the whole workbook. Attachment storage/delivery is a separate workflow.

## Supported subset and limits

- Modern unencrypted OOXML .xlsx, stored or deflated ZIP. Requires browser DecompressionStream support.
- 2 MiB input, 128 ZIP entries, 2 MiB per expanded entry, 8 MiB total expanded data.
- 16 sheets; 1,000 rows, 64 columns per sheet; 20,000 cells overall; 10,000 characters per cell/shared string.
- Validated central/local ZIP records, non-overlapping payloads, safe part names, bounded streaming inflation, exact decompressed lengths and CRC32.
- XML validated before parsing with fast-xml-parser 5.12.0 (npm audit clean when added), no DTD/custom entities, depth 64 and element count 150,000.
- No formula execution or fetching external resources. Macro, embedded-object and external-link parts/relationships rejected. Formulas use saved cached results with an explicit stale-cache warning. Missing caches/errors in imported amounts, categories or metadata block use.
- Summary From/To numeric Excel dates support 1900/1904 calendars. Tiny binary floating-point noise is normalized; real fractional pennies remain invalid.
- Unsupported/malformed formats fail closed with an explanation. Exporting the Summary worksheet to CSV remains available.

## Verification

Node regression suite covers synthetic stored/deflated workbook files, sheet selection data, formula caches, invalid caches/category errors, date conversion, decimal precision, corrupted ZIP, forged expanded sizes, external links, encryption, macros, traversal, XML entities/depth, cell coordinates and duplicate cells. Existing CSV and share tests remain.

The actual supplied workbook was tested privately outside the repository. No private workbook, content fixture, or source-derived example is committed. Browser smoke script now covers explicit worksheet selection, missing shares, reset and review invalidation alongside the existing CSV path. Running that script requires an environment where Chromium can create its local sockets; it was blocked in the current environment (process singleton socket EPERM), so no updated browser pass is claimed.

## Service charge summary handoff

Service charges has manager-only budget/demand and delivery tabs using the existing financial preparation and dispatch components. Import can optionally retain the displayed category names, amounts and total after a separate disclosure approval. Saving binds that summary to building, year and schedule. Manual amount/name/year edits remove stale summaries. Initial versus later demand is an explicit choice, reset on preparation changes. The dispatch workflow separately validates and reviews the generated recipient PDF. No original workbook sheets or notes are passed to delivery.

Typecheck, 158 automated tests and a production build were run on the combined changes; browser interaction remains unverified because Chromium socket creation was blocked. Source-contract tests are not a substitute for browser interaction testing.
