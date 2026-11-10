# Resident demand layout

The supplied invoice example was visually inspected. The saved financial-batch demand renderer now follows its structure: upper-right agent branding, recipient/property block on the left, issue/property/invoice-reference/due-date details on the right, centred Application For Payment heading, two-column description/value table, payment instructions, landlord/service-notice addresses, and a separate rights-summary page.

This is a layout adaptation, not an exact replica. It uses AVIAF text branding and current scoped portal facts. The example's personal details, payment information, historical payments and bank identifiers are not seeded into source. No source PDF is committed. The renderer currently uses the unit/property address and generic Leaseholder(s), since the batch generator does not supply a verified correspondence address. IBAN and SWIFT are not inferred or copied into existing settings.

The table includes the saved schedule's percentage, annual budget and charge period. The total is labelled amount demanded, before separately recorded payments or credits. The sample's payment-to-zero row is not invented: verified current outstanding balances remain available in the resident account statement. Draft labels, exact posted-ledger reference verification, reviewed landlord/payment requirements, immutable document hashes and no-send behavior are preserved.

Scope: this updates HTML preview/download from saved financial batches and its matching text snapshot. The existing multi-entry resident account-statement view stays unchanged. Browser Print / Save PDF remains the document-to-PDF path; no new automatic PDF email attachment was added.

Verification: five document tests and TypeScript pass. A synthetic issued-layout HTML was rendered with WeasyPrint and both PDF pages visually inspected; demand and rights content were legible without clipping. Chromium/browser interaction validation remains unavailable in this environment. Legal rights wording is the existing portal text, preserved rather than copied from the old example or independently legally certified.
