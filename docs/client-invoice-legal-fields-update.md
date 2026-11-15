# Client invoice field fixes — unpublished

This update supersedes the missing-contact/supply-date findings in `client-invoice-legal-fields-review.md`. No real issuer or VAT status was inferred. The implementation, proposed SQL and renderer remain unpublished; production has not been modified.

## Implemented

- New drafts have `invoiceType: 'unselected'`, no supply date and no tax point. They may be saved incomplete, but Review and Issue require an explicit supported type: non-VAT for a declared unregistered issuer, or VAT for a declared registered issuer. The type and existing registration boolean must agree. Choosing VAT does not set a tax rate. Choosing non-VAT/unselected clears tax point/number and resets rates to zero; positive VAT still cannot be charged with registration off.
- Issuer contact email or phone is required before Review/Issue. Both are printed when configured. Phone uses a bounded, single-line digit/punctuation format, with at least three digits; this validates input shape, not whether the phone belongs to the issuer. Name and address remain required. Contact fields are never used for sending email here.
- A valid explicit `supplyDate` is required for every ready invoice. VAT invoices also require a valid explicit `vatTaxPoint`; non-VAT documents reject a tax point. Neither date is silently copied from the billing period or invoice date. The responsible reviewer must establish their correct meaning for the actual transaction.
- UI, TypeScript/API/PDF readiness and direct database RPC validation enforce the new fields. Both Review and Issue revalidate, before number allocation. Incomplete drafts stay unnumbered. New fields remain immutable with the issued document and audit snapshots.
- PDFs show contacts, supply date and conditional VAT tax point. VAT documents have a VAT INVOICE heading and explicitly sterling VAT total. Non-VAT documents explain that VAT is not charged and omit percentage/zero-VAT totals that could imply a verified zero-rated supply.

The additive proposal's existing object list, RLS, grants, sequence isolation, audit, idempotency and activation gates are unchanged. Only JSON document validation inside the proposed validator changes; no extra database objects, permissions or production data migration are introduced beyond the already pending proposal. Current SQL SHA256: `b89be79304b7ee2a9054f5b2647fc57016afede141ca422e1c27250f10de1010`.

The initial version-1 format was never published/applied to production. Its new required keys are deliberately not silently invented for older local fixtures. Recreate or explicitly revise any disposable staging drafts created under the earlier proposal; do not backfill an assumed supply date or VAT status. No existing production invoice rows exist for this unpublished feature.

## Official field recheck

Rechecked [GOV.UK ordinary invoice requirements](https://www.gov.uk/invoicing-and-taking-payment-from-customers/invoices-what-they-must-include) and [HMRC Notice 700/21 sections 3–4](https://www.gov.uk/guidance/record-keeping-for-vat-notice-70021#vat-invoices-detailed-rules) on 15 November 2026. The samples visibly contain number, supplier name/address/contact, customer name/address, description, supply date, invoice date, charges and total. The hypothetical VAT sample additionally shows VAT identity, tax point, actual issue timestamp, quantities, unit/net amounts, rate and GBP VAT total. These fields do not establish that a real issuer or transaction is eligible for the selected treatment.

Samples were generated with `node tests/generate-client-invoice-review-samples.mjs`, using local in-memory fixtures only:

| Fixture | Content and hash |
| --- | --- |
| `/tmp/london-client-invoice-review-updated/non-vat-phone-contact-sample.pdf` | Phone-only supplier contact; supply date 31 January, invoice/actual fixture issue date 2 February, £100 total; no VAT rates/totals. SHA256 `8178356ddb8b4c0bba9b5ca03dac367a04677fc4889e1e476a21df78e909f70d`. |
| `/tmp/london-client-invoice-review-updated/hypothetical-vat-sample.pdf` | Contact email, supply/tax point 31 January, invoice/actual fixture issue date 2 February; explicitly synthetic VAT identity and hypothetical 20% test rate, £100 net + £20 VAT = £120. SHA256 `18c9497ba8dfd8de12abe07a480ca799d91f0054614dcaed221e0194a753ff36`. |

Extracted PDF contents with `pdftotext -layout`, rasterized both PDFs with `pdftoppm`, and visually inspected both final pages: new fields, amounts, headings and pound signs are legible and uncut. Sample numbers are fixture text, not database sequence allocations; both files explicitly state SYNTHETIC SAMPLE ONLY. No real invoice or application record was created. The older report's sample hashes refer to earlier evidence and are superseded by these samples.

## Tests and limits

- `npm test`: 277 passed, zero failed/skipped (272 existing plus five new model/UI tests).
- `npm run typecheck`: passed.
- `npm run build`: passed on Next 16.4.6. Generated `next-env.d.ts` restored afterward.
- `PGLITE_MODULE=/tmp/london-verification/node_modules/@electric-sql/pglite/dist/index.js node tests/run-pglite-client-invoices.mjs`: passed. Under production-style grants and authenticated owner role, direct RPC rejects missing contact/type/supply date/tax point at Review and revalidates those failures at Issue without advancing numbering. It rejects invalid dates/phones and type/registration mismatches, supports a complete phone-only invoice, and produces a complete VAT issued snapshot/PDF. Existing ACL/service-role/sequence, scoped access, disabled-write/issue, audit, replay, concurrency and unchanged-ledger checks still pass.
- `git diff --check`: passed.

Remaining before real issue: establish issuer legal identity/form, legal/contact addresses, actual VAT registration/number and applicable tax rates/treatment; confirm correct customer, service extent, supply date and VAT tax point, number series and payment details. The system does not verify government tax registries or infer a tax point. A selected boolean/type/number is a declaration, not verified registration. Rates remain reviewed numeric inputs; no standard rate is assumed. Special schemes, exemption classification, reverse charges, cash discounts, credit notes/refunds and VAT return/accounting remain unsupported and must not be represented as supported by this workflow. Existing notes cannot turn an unsupported transaction into a validated tax treatment. Confirm issuer-specific naming requirements, correction/retention policy and external accounting handoff before enabling Issue.

Safe rollout remains staged: verify the latest identified London backup/recovery window and Storage protection; test the exact SQL in staging; obtain separate migration authorization; keep database writes/issuing disabled during installation and initial application verification. App flag alone is not a database kill switch. Resolve issuer-dependent checks before any separate authorization to enable real issuing. No push, deployment, production migration, live records, emails or Lovemore Park changes occurred.
