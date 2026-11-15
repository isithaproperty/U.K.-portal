# London integrated release — 15 November 2026

Brian authorized pushing and deploying the three prepared features, accepted the older-backup risk and described the current contents as dummy data. That authorization did not permit clearing anything. Existing data and Storage were preserved. No backup restore, email, live test resident, invoice or financial transaction was created.

## Released scope and controls

- Units & residents and block Residents gain audited name/contact-email/phone editing. Portal sign-in email, IDs, ownership and financial references remain unchanged. Contact email is separate from sign-in identity and reviewed financial delivery contacts/consent.
- Staff see block-scoped **Last account sign-in (may include recovery)**. This reads existing Auth metadata, not session-refresh/activity dates, and does not establish portal-visit history. Missing account/timestamp/uncertain states remain explicit. Residents/contractors cannot call the new staff read capability.
- Management company Client invoices supports standalone draft creation, PDF preview and owner/admin review. No automatic email, resident charge, supplier settlement or ledger integration is introduced. Invoice type starts unselected; supplier contact and supply date are required for review; VAT type additionally requires a tax point and explicitly entered registration/rates.
- **Final invoice issuing stays disabled.** Production database configuration is writes_enabled=true, issuing_enabled=false. Application flag `LONDON_CLIENT_INVOICE_ISSUING_ENABLED=false` also blocks Issue before mutation and hides its button; the section displays draft mode. A future change requires separate issuer/VAT/numbering approval and both application/database gates. No issuer or VAT status is assumed.

Production-only app flags for client invoices, contact editing and account sign-in display are true. The existing ledger-batch setting is unchanged. Preview flags were not enabled. App flags alone are not global database freezes: contact edits and scoped reads remain callable directly by authorized staff after installation; invoice mutation is governed independently by the database flags.

## Applied migrations

The Supabase migration registry confirms these versions; matching SQL is checked into `supabase/migrations`. The docs/proposed copies are retained as reviewed source history and must not be reapplied.

| Version | Migration |
| --- | --- |
| 20261115025443 | london_client_invoice_drafts_and_review |
| 20261115025453 | london_audited_resident_contact_editing |
| 20261115025505 | london_scoped_resident_account_sign_ins |
| 20261115025602 | london_enable_client_invoice_drafts_only |

The first three proposals were applied with their reviewed hashes: client `b89be79304b7ee2a9054f5b2647fc57016afede141ca422e1c27250f10de1010`; contacts `53caf6287cfbd621929472a4f98d7fceaf60f73081f91e146a5c9ca10ad2a921`; sign-ins `5f078a576082bee8d868b93deb6023d12786fe4721f06e0742b3fab190c4054e`. The fourth only activates the new private configuration row for draft/review writes, leaving issuing false.

Existing resident policies were not replaced. New invoice/history tables have RLS and scoped SELECT only for authenticated staff; direct table writes, audit writes and sequence use are denied. New public RPCs are invoker wrappers or invoker contact editing; privileged helpers live in private with empty search paths and explicit scope checks. Anon/service_role receive no new function/table/sequence access. Resident triggers version and atomically audit future changes; no history is backfilled. The new private configuration table intentionally has RLS and no application policy/grant.

## Preservation and verification

The pre-migration baseline had 28 residents, 28 units, 28 service-charge rows and six Storage objects. Immediately after the three schema migrations, integrity digests matched for all legacy resident columns, units, service-charge rows, Storage metadata and Auth email/sign-in records. All 28 residents had null new contact email and default version 1. New invoice, invoice-event and contact-history tables were empty. Draft-only activation left those tables empty. No individual private records or secrets were exported for these checks.

- `npm test`: **291 passed**, zero failed/skipped. Includes combined resident-view/flag regression and application draft-only Issue denial/UI behavior.
- `npm run typecheck`: passed.
- `npm run build`: passed with Next 16.4.6. Generated next-env.d.ts restored afterward.
- `PGLITE_MODULE=/tmp/london-verification/node_modules/@electric-sql/pglite/dist/index.js node tests/run-pglite-integrated-portal-release.mjs`: passed. All three exact proposals installed together in a synthetic disposable database; ownership/Auth/ledger/Storage rows preserved; contact audit/archive/version conflicts; identity unchanged; role/block denial; draft/review with Issue blocked; full Issue/Void lifecycle tested **only locally** with local gates, then reset to planned draft-only configuration; immutable invoice audit and independent master freeze.
- Production read-only ACL checks confirmed intended function, table and sequence privileges and false issuing flag. No production mutation RPC was used for acceptance tests.
- `git diff --check`: passed.

Deployment SHA/health and unauthenticated endpoint verification are recorded in the handoff. No authenticated production create/edit/import/archive or actual sign-in/refresh workflow was exercised: doing so would change live records or Auth state. Local fixtures and catalog checks do not substitute for a full hosted Auth/PostgREST browser end-to-end test. The earlier physical-backup, Storage backup and untested-restore limitations remain; acceptance of risk does not establish recovery readiness.

Security advisors retain pre-existing [bulk-reminder public-definer](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [leaked-password-protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) warnings. The additional [RLS/no-policy informational finding](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) on private.client_invoice_configuration is intentional deny-all for application roles, verified by grants. Those unrelated settings were not changed.

## Withdrawal without deleting data

Keep issuing disabled. To freeze invoice mutations, an authorized operator sets writes_enabled=false and issuing_enabled=false together. Disable app feature flags and redeploy if withdrawing views. For a database-level freeze of the new contact/read capabilities, revoke authenticated EXECUTE on their public and private entry points as applicable; do not revoke private-schema USAGE globally. Retain additive columns, invoices and audit histories. Do not drop data or restore the whole project as a routine application rollback. No destructive down migration is provided.
