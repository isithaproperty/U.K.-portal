# Generated client invoice review — 15 November 2026

Reviewed the renderer and validator at `593267143f76168f88c8cae60e275632d664364b` against the two requested primary sources. This is a field/configuration review, not verification of an actual issuer, tax status or transaction. The real issuer and VAT status remain unknown. No database mutation RPC, real invoice issue, email, financial posting, deployment or migration was performed. Both proposed database write/issue gates remain default false; no production configuration was changed.

## Local synthetic evidence

Generated two issued-shape PDF fixtures directly in memory from `tests/fixtures/client-invoices.mjs` and `buildClientInvoicePdf`; these were never saved to an application database and did not allocate numbers from the application sequence. Each contains an explicit SYNTHETIC SAMPLE ONLY note. Numbers `MCI-99999991` and `MCI-99999992` are fixture text, not issued invoice numbers.

- `/tmp/london-client-invoice-review/non-vat-sample.pdf`: synthetic nonregistered issuer, £100 net/total, £0 VAT. SHA256 `c0d2675cf4ce9e64026ef51aefcbe137580dd03bd253ac6fae58da285be0bee6`.
- `/tmp/london-client-invoice-review/hypothetical-vat-sample.pdf`: explicitly hypothetical registered configuration with obviously synthetic VAT number and 20% test rate, £100 net, £20 VAT, £120 total. SHA256 `6cb4b42b46fe9a763b1bcf5160b976c2ce8d2ce81cd83873325dd2bfacc899b0`. This rate/status is not an assumption about the real company.

Extracted actual PDF contents with `pdftotext -layout`, rasterized and visually inspected the VAT sample page; text, pound signs, parties, number, dates, lines and totals were legible and uncut. Fontconfig emitted cache warnings during rasterization but generated the inspected image successfully. Renderer output repeats the heading; this is cosmetic. No code or renderer version was changed by this review.

## Ordinary invoice fields

[GOV.UK invoice requirements](https://www.gov.uk/invoicing-and-taking-payment-from-customers/invoices-what-they-must-include) require identification, supplier contact details, customer identity/address, description, supply and invoice dates, charges and total, and VAT where applicable. Sole traders and limited companies have additional naming requirements. Sample mapping:

| Field | Existing output and gap |
| --- | --- |
| Identification | Unique stable MCI number after Issue; drafts unnumbered. Confirm series against any external existing invoice system before activation. |
| Supplier | Name, address, email and optional company number printed. **Contact email may be blank in a ready document; no alternative contact field is guaranteed.** Legal entity/name/address are user input, not verified. |
| Customer | Required name/address printed; correct contracting customer must be confirmed. Block identity is additional context. |
| Service and supply date | Required descriptions and billing period printed. **No explicit supply date field or confirmation that a billing period accurately establishes the relevant supply date.** |
| Invoice date and amounts | Invoice date, actual issued timestamp, due date, quantity, price, charges and total shown. Confirm the invoice date/actual issue date interpretation rather than treating the due date as supply date. |

The issuer configuration must establish legal form: full incorporated name for a company, or legal personal/business names and an address for legal service where required for a sole trader. No director names are automatically listed. Existing free-text fields can carry correct names/address, but the workflow does not establish they are correct.

## VAT, only if applicable

[HMRC Notice 700/21, sections 3 and 4](https://www.gov.uk/guidance/record-keeping-for-vat-notice-70021#vat-invoices-detailed-rules) restrict VAT invoicing to registered suppliers and specify sequential identification, supply/issue details, supplier VAT identity, customer, service extent, unit/net prices, VAT rates, sterling VAT totals and any cash-discount rate; special schemes have additional rules.

| Conditional VAT field | Existing output and gap |
| --- | --- |
| Sequence | Database sequence produces stable MCI series; fixture numbers do not test production issuance. |
| Supplier VAT identity | Explicit registration boolean and nonempty number required for VAT charging. **Existence/validity/ownership of the number is not verified.** |
| Supply/issue | Billing period, invoice date and issued timestamp shown. **Explicit reviewed tax point is missing.** |
| Lines and totals | Description, quantity, unit price, net line/overall totals, VAT percentage, line/overall VAT and gross total in GBP shown. |
| Discount/special cases | Notes can describe terms, but **no structured cash discount, exemption versus zero rate, reverse charge or margin-scheme workflow is implemented.** Do not use unsupported cases. |

The basic field review does not establish VAT accounting, electronic-record retention compliance or tax treatment. This feature deliberately posts no financial/VAT account. Issued snapshots and deterministic PDFs support history but do not constitute a complete accounting/filing system.

## Proven validation gaps and activation blockers

Local calls to `validateClientInvoiceDocument(document,true)` confirmed it accepts an empty issuer email, an unverified synthetic VAT number, and an arbitrary configured rate of 12.34%. A syntactically complete ready document is therefore **not** proof it can lawfully be issued. Numeric rates are bounded for arithmetic, not vetted against a transaction's tax treatment. With registration off, positive VAT and a VAT number are rejected; default false does not establish the real issuer is unregistered. Non-VAT output still displays 0% line rates and a zero VAT total alongside the nonregistered statement; clarify this wording before use so it does not imply a verified zero-rated VAT supply.

Before enabling real Issue, resolve these concrete prerequisites:

1. Establish and approve issuer legal identity/form, verified contact/legal address, confirmed registration status and, only if registered, its correct VAT number and applicable transaction treatment/rates. Confirm the customer, service description/extent, prices and numbering convention. No issuer values should be inferred from the portal name.
2. Add or explicitly resolve a supply-date field and, where applicable, a reviewed tax point, with date semantics enforced consistently in UI, server validation, direct RPC validation and PDF. The billing period alone is not treated as a verified substitute by this review.
3. Require supplier contact information at readiness/issue in both TypeScript and SQL, or provide another guaranteed configured contact method. Confirm actual issue date versus invoice date. Restrict unsupported VAT/discount/special-scheme transactions or implement their explicit fields and validation before allowing them.
4. Decide and implement approved issuer/tax configuration controls; a per-document self-declared boolean/number/rate is not verified configuration. Preserve default-off write/issue gates until these checks and the existing migration/security/recovery review are complete. Consider a separately staged draft-only rollout; do not silently open issuing.
5. Retain issued copies and audit evidence; review corrections/credit-note needs separately. The current Void status is not represented as a tax credit-note workflow. Confirm accounting handoff and record retention with the responsible issuer team.

These are review findings; no unrequested schema or renderer change was made. Client invoice SQL remains at SHA256 `bf9e17754870b90fd699a6e247c764ef68d1d6b6ddafa85d8ad80608a2c986cb`. Existing technical test success does not remove the issuer/supply-date/configuration blockers above.
