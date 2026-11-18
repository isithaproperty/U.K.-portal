# DARP and Building Safety Case document sections

Base: deployed London release `ac5a1872fa592a561c637d65060fcfb9f30db516`. London only; Lovemore Park untouched.

## Implementation

- Existing BSC navigation is expanded to **Building Safety Case (BSC)**. It opens the existing **Safety Case Report** folder; all ten existing supporting folders and persisted category values remain available. No second BSC area/category or document relocation is created.
- Adds a separate **DARP** tab under per-building Health & Safety, headed **Disaster Action and Recovery Procedure (DARP)**. Records use the existing `DARP` text category, private `building-safety-documents` bucket and `<block-id>/<unique-file-name>` paths.
- DARP and Safety Case Report show newest-first upload history, current document status, upload date/uploader, notes and optional review date. New plan uploads default to **Under review**. Uploading does not record approval or establish compliance.
- Each revision is a new upload (`upsert:false`), preserving earlier documents. No existing records/files are changed, relabelled or backfilled. Formal immutable reviewer-event history does not currently exist and has not been invented; this is upload history plus current document metadata.
- Existing five-minute private signed document links and upload failure handling are reused. Document selection/details are cleared when changing sections, folders or buildings, preventing a pending file from being silently retargeted. Active uploads retain the existing submission/navigation lock.
- The separate DARP template is not generated, fabricated or uploaded by this change. No template link is published before the file is supplied. The existing bucket accepts PDF/JPEG/PNG/WebP up to 10 MiB; Word templates must be exported to PDF for upload. DOCX access is not enabled.
- Existing audit requirements are unchanged; adding a document folder does not add a mandatory compliance-signoff requirement. Existing delete behavior and permissions are not expanded.

## Compatibility and security

Read-only London schema inspection on 18 November confirmed `building_safety_records.category` is text without an allowed-category constraint; existing record checks concern title/status and the block reference. The bucket is private with the existing size/MIME limits, and record RLS is enabled.

**No migration, policy/grant change, bucket change, role/membership change, environment-variable change or Edge deployment is needed.** Existing owner/admin scope and the two named managers' reciprocal scope continue to govern record and Storage access. No real upload, email, deletion, financial action or production data mutation is used for verification.

## Verification

- `npm test`: **329 passed, 0 failed**. New component tests cover one BSC area/legacy record visibility, DARP name/history/building filtering, scoped uploads/actual actor/default status, pending-form clearing, signed URL expiry and unchanged DOCX rejection. Existing upload, reciprocal-cover, finance and Edge tests remain in the full suite.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `PGLITE_MODULE=/tmp/london-safety-verification/node_modules/@electric-sql/pglite/dist/index.js node tests/run-pglite-manager-cover.mjs`: passed, with added DARP/Safety Case Report record insert/read checks for both named managers and foreign-block denial. Disposable synthetic database only; existing policy/privilege boundaries unchanged.
- No authenticated production upload/document-browser session or real file transfer was tested. Component uploads, private links and window opening use mocks. These results do not certify document content, emergency procedures or regulatory compliance.

## Release

Coordinator confirmed that Brian's feature request authorizes routine nonsecurity deployment after checks. Release only these application/test/documentation changes. Reconfirm main has not moved, commit/push the tested branch and fast-forward main, verify Vercel's exact production SHA/alias/health, and keep both existing Edge versions, schema, flags and permissions untouched. Do not create a real test plan or send emails.

Rollback is an application-only Vercel rollback or source revert to `ac5a187`; preserve any real documents uploaded after release. There is no database rollback and no reason to remove a new category's records/files. Stored-file restore remains outside this change and unverified.
