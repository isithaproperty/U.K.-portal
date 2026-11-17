# Health & Safety document upload — fixes prepared, approval required

Investigated London only on 17 November 2026. Main and production remain `471f09f884903966224744685c06b728196b61d9`; Vercel deployment `dpl_A98NAZx6XoM8KNARkrwzzX62D4pf` is READY. This work is isolated on `fix/safety-document-upload` in `/workspace/london-safety-upload`. No production uploads, safety records, policy changes, migrations, deletions, emails or Lovemore changes were performed.

## Two failures found

1. **BSC selection stopped before upload.** The deployed component opens the file chooser under BSC, but renders the save form only when activeSection equals General Health & Safety. Selecting a BSC file therefore sets file state without displaying a title/save form. A regression harness using the deployed source reproduced this: “BSC selection must expose the form” failed before the change. The corrected source makes the form available under both sections.
2. **The deployed Storage policies use the wrong name.** All three portfolio safety Storage predicates join `b.id = split_part(b.name, '/', 1)::bigint`. They parse the building name, rather than `storage.objects.name`, so correctly formed object paths can fail with SQLSTATE **22P02** for a nonnumeric building name. A synthetic database recreated the exact predicate and reproduced that rejection. With numeric-leading names, the old predicate can instead ignore the object's block prefix and admit cross-block objects; the regression also demonstrates that latent boundary defect.

Read-only production inspection confirmed the bad expressions on the SELECT/INSERT/DELETE policies. Of 86 current buildings, 85 have nonnumeric name prefixes. The bucket and record tables currently contain zero Health & Safety objects/records. Retained edge-log inspection in the available last-24-hour window found no building-safety object-upload requests; it does not supply a production failed-upload response or prove that none was attempted outside retention. No real upload was initiated to manufacture an error. The frontend reproduction explains why the BSC path does not reach Storage.

## Prepared source changes

- `app/BuildingSafetyRegister.tsx`: exposes the BSC save form; resets the file input so the same file can be selected again; states the existing bucket formats/limit; uses a synchronous submission lock; releases busy state on thrown errors; explicitly uses append-only upload (`upsert:false`); does not insert a safety record after a rejected upload; retains uploaded files if the subsequent record save is unconfirmed and reports a reference instead of deleting them.
- `lib/building-safety-upload.ts`: validates nonempty files up to the existing 10 MiB limit and existing PDF/JPEG/PNG/WebP MIME types. Empty/generic browser MIME is inferred only from those known extensions. Unsupported Word/HEIC/HTML files receive an explanation. This is input-shape validation, not a content/virus scanner, and does not change bucket permissions or formats.
- Regression tests cover BSC save, storage rejection, network/save failures, duplicate submission, same selected block/category, existing General/Insurance forms and file restrictions. Existing inspection/photo, audit, legal deadlines and deletion workflows are not expanded by this patch.

## Exact policy approval needed

`supabase/building_safety_storage_scope.sql` already existed as an unapplied correction. The prepared version adds lock/statement timeouts and nonblank-manager checking. It alters only:

- `portfolio scoped safety storage read` — SELECT USING.
- `portfolio scoped safety storage insert` — INSERT WITH CHECK.
- `portfolio scoped safety storage delete` — DELETE USING.

Each predicate keeps the same private bucket and authenticated role, requires a canonical one-segment path `^[1-9][0-9]*/[^/]+$`, and compares `b.id::text = split_part(objects.name, '/', 1)`. Membership remains owner or an exactly assigned manager; empty/whitespace portfolios are denied. Separate admin policies, grants, table RLS, bucket visibility, size/MIME restrictions, records and object contents remain unchanged. No service-key proxy or privilege bypass is introduced.

A transaction uses a five-second lock timeout and thirty-second statement timeout. Re-read the live definitions, object counts and membership/policy scope before any later application; do not assume this review freezes a launching portal. Register the approved correction using the project's migration workflow and verify installed definitions/ACLs after application. No migration filename/version has been invented or applied here. Reverting blindly to the old predicate would reinstate a known failure and possible scope defect; any withdrawal plan should preserve records/files and receive explicit review.

**This is a security-sensitive policy change, so the current instruction requires explicit approval before application.** The source fix alone cannot make uploads succeed reliably while these deployed predicates remain. The prepared UI fix has therefore not been pushed to main or deployed as a purported complete solution.

## Backup and recovery coverage

London project identity was reverified: `yhyqxvbquavhndxcwttt`, ACTIVE_HEALTHY, eu-west-2, PostgreSQL 17.6. At 19:49 UTC, Storage metadata showed six objects overall and zero in this target bucket; no file bytes were read/copied. WAL archive mode was on, last archived 19:46:48 UTC and zero recorded failures. WAL activity does not establish a managed snapshot inventory, PITR window or tested restore.

The historically supplied project-labelled daily physical snapshots excluded Storage objects. Current snapshot/PITR inventory is not exposed by available tools and was not independently verified. No restore has been tested or attempted and no new logical/file backup was made. The earlier dummy-data characterization is not being used as permission to delete or treat launch data as disposable. Backup coverage must be explicitly acknowledged/resolved before the separately approved database-policy step; database snapshots alone do not protect Storage file contents.

## Verification

- `npm test`: **311 passed**, zero failed/skipped (304 baseline plus seven UI/model regressions).
- `npm run typecheck`: passed.
- `npm run build`: passed on Next 16.4.6. Generated next-env.d.ts restored afterward.
- `PGLITE_MODULE=/tmp/london-safety-verification/node_modules/@electric-sql/pglite/dist/index.js node tests/run-pglite-safety-storage-scope.mjs`: passed. Reproduces the legacy SQLSTATE 22P02 and numeric-name scope bypass; after the proposed correction, confirms owner/admin and assigned-manager behavior, denies foreign/blank/null/whitespace managers, residents, contractors, anonymous users, wrong buckets and malformed/missing block paths. Existing synthetic object rows and separate admin policies are unchanged by the correction.
- `git diff --check`: passed.

Logs: `/tmp/safety-ui-before.log`, `/tmp/safety-tests.log`, `/tmp/safety-typecheck.log`, `/tmp/safety-build.log`, `/tmp/safety-policy-tests.log`. The PGlite dependency is pinned under a task-local /tmp directory and was not added to production dependencies.

Supabase changelog and current [standard-upload guidance](https://supabase.com/docs/guides/storage/uploads/standard-uploads) were reviewed; no relevant SDK breaking change explains this failure. Production advisors show existing unrelated [RLS/no-policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [public bulk-reminder definer](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) findings, unchanged by this task.

Authenticated live verification remains unperformed: no real account login, file upload or safety-record save was used. Deployment and an authenticated end-to-end acceptance check remain pending the policy decision and any separately authorized test. A safe follow-up should not create/delete a real user's launch document merely to test.
