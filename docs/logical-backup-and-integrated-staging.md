# London backup and integrated staging feasibility

> Historical preparation/review below. The subsequently authorized integrated release and applied migrations are recorded in [london-integrated-rollout.md](london-integrated-rollout.md). Backup/restore and authenticated-testing limitations remain as described there.


Assessment: 15 November 2026. **A secure current production logical backup and independently verified restore cannot be completed with the credentials presently provisioned here.** Docker works, and all three prepared application branches have now been combined and checked locally. That is code integration evidence, not a backup, restored database or full staging verification.

No backup was generated or transmitted, no restore was attempted, no SQL migration was applied in this investigation, no hosted branch/project was created, and nothing was pushed/deployed. Existing production rows, schedules and configuration were not changed. Lovemore Park was untouched.

## Access and tooling actually checked

| Capability | Concrete result |
| --- | --- |
| London identity | Connected project ref `yhyqxvbquavhndxcwttt`; existing production/main source `1622514`. |
| Read-only inspection | Authorized Supabase SQL connector executes as postgres. Catalog/aggregate checks work. It does not expose a reusable PostgreSQL connection/password or backup download. No server files/OS commands were invoked through SQL. |
| Direct dump credentials | No `DATABASE_URL`, `DIRECT_URL`, Supabase DB URL/password/PAT, PG connection/password/service variables or service-role key in the process. No credential-bearing `.env` in the London worktrees; only `.env.example` with two public-variable names. No home/workspace pgpass or service file, linked pooler URL/project-ref or local Supabase config. Checks printed names/presence only, never credential values. |
| Other connected metadata | A dedicated Vercel environment listing with decryption explicitly false returned three variables: `LONDON_LEDGER_BATCHES_ENABLED`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; no pagination. No DB connection/password or service key appears in that project listing. No Vercel process/CLI auth credential was present locally. No secret value was printed or decrypted. This does not inventory unrelated account-level secrets. Supabase SQL-connector authorization cannot be repurposed as a database password. |
| PostgreSQL clients | Native pg_dump, psql, initdb and postgres are not on PATH. Docker server 28.4.0 responds successfully; its local image inventory is empty, so no ready PostgreSQL/Supabase image was verified. No image was pulled or container/database started. |
| Local CLI | Earlier Supabase host CLI initialization was blocked by its read-only home configuration path. No HOME override or production password reset was attempted. A separately prepared containerized toolchain could avoid host initialization, but remains untested. |
| Encryption/storage | OpenSSL 3.5.7 is installed. No backup encryption key, approved retention location or durable encrypted backup arrangement is provisioned/verified. Presence of an encryption utility is not proof that a backup is secured. |
| Existing staging | Supabase branch inventory is empty. No dedicated hosted staging project was assumed, created or charged. The London repo has SQL proposals/fixtures but no local `supabase/config.toml` stack configuration. |

A SQL metadata reader is useful for inspection but not a substitute for pg_dump's consistent snapshot and schema/data/sequence/ownership/dependency handling. Although `pg_export_snapshot()` privilege is present, the connector provides no documented persistent transaction/session for a dump client to share. We did not try to export real tables as JSON through tool transcripts: that would neither establish a complete restorable dump nor meet the intended local confidential-backup handling.

## Current coverage and restore hazards

At 02:33 UTC the production database measured 17,493,139 bytes via `pg_database_size` (not a dump-size estimate). Its application environment includes public/private, Auth, Storage, migrations, realtime and extension-related schemas. Installed extensions include plpgsql, pg_stat_statements, uuid-ossp, pgcrypto, supabase_vault 0.3.1, pg_cron 1.6.4 and pg_net 0.20.4. A plain PostgreSQL image alone is not demonstrated compatible with all these Supabase-managed objects and services.

There is an **active contractor-document-expiry schedule at minute 5 of every hour**, plus one Vault secret. Secret values and cron command text were not read. A restored environment must have background jobs/workers disabled and external network/email/payment access blocked **before** restored jobs or application services can run. Do not load a production environment file or use production API keys in staging. Vault ciphertext/secret configuration and managed role/service dependencies need an explicit recovery design rather than assuming that table restoration makes every service operational.

Storage metadata currently lists six objects in four private buckets: contractor-documents, building-safety-documents, work-order-documents and staff-work-order-documents. No object bytes were downloaded, checksummed or copied. A complete file recovery requires separately authorized Storage read access and a byte-level manifest/copy/integrity test; a database dump or managed snapshot does not provide those contents. [Supabase backup coverage](https://supabase.com/docs/guides/platform/backups).

The supplied labelled screenshot establishes London's visible daily physical backup inventory, latest 14 November 07:34:34 UTC. The available tool set offers no managed backup inventory/download/PITR-window operation, so no newer managed recovery point was verified. Restore was not used as a probe. A new local logical dump would supplement the managed backup; it would not verify that snapshot's restorability or provide a PITR window, offsite durability or Storage bytes.

[Supabase's backup/restore guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) requires an authenticated database connection and treats Storage and Edge Function migration separately. [Platform-to-self-hosted guidance](https://supabase.com/docs/guides/self-hosting/restore-from-platform) also identifies service/version/configuration dependencies. The exact schema/data/roles filters must be inspected against this project: a schema-only or filtered application export must not be presented as a complete Auth/Storage/roles backup. Do not silently omit restore errors or managed objects and still claim success.

## Integrated code review completed

Created isolated `/workspace/london-integrated-review`, branch `review/integrated-london`, combining:

- Client invoices: `68e0fe5`.
- Resident contact editor/recovery documentation: `a760db6`.
- Resident account sign-in display: `79e9576`.

Resolved overlaps in page data, Portal props, resident types and the three resident views. All three independent default-off feature gates remain. Contact email stays separate from sign-in identity; existing name/contact editing, archive, sign-in status and client-invoice review controls are retained. Original three branches/worktrees remain clean and unchanged.

Verification: `npm test` passed **289 tests**, zero failures/skips (286 combined existing tests plus three integration checks); `npm run typecheck` passed; `npm run build` passed on Next 16.4.6; `git diff --check` passed. The new integration checks render contact edit/archive/sign-in together against one synthetic assignment, check preserved flags/data mappings and inspect proposal names without SQL execution. Logs: `/tmp/london-integrated-tests.log`, `/tmp/london-integrated-typecheck.log`, `/tmp/london-integrated-build.log`. Generated `next-env.d.ts` was restored afterward.

Read-only production catalog checks found no proposed function/relation-name collisions and neither pending contact column. The three proposals are unchanged and have distinct object names:

| Proposal | SHA256 |
| --- | --- |
| Client invoices | `b89be79304b7ee2a9054f5b2647fc57016afede141ca422e1c27250f10de1010` |
| Resident contact editing | `53caf6287cfbd621929472a4f98d7fceaf60f73081f91e146a5c9ca10ad2a921` |
| Resident account sign-ins | `5f078a576082bee8d868b93deb6023d12786fe4721f06e0742b3fab190c4054e` |

Earlier tasks tested each proposal separately in disposable PostgreSQL. **The combined proposals have not been executed together or against a restored production schema.** The current instruction to hold migration application was preserved. npm tests/build do not exercise a hosted Auth/PostgREST/Storage stack or verify production data compatibility after migration.

## Safe next test, once explicitly authorized and provisioned

1. Securely provision a London-specific TLS database connection with sufficient approved backup read privileges, without posting passwords in chat or resetting live credentials. Establish matching PostgreSQL 17/Supabase tools and an encrypted local destination outside Git (private directory and restrictive file permissions), with a separately held key and retention decision. No external destination is authorized.
2. Generate a consistent logical export with explicit schema/data/roles/sequence coverage, manifest, source identity/version, snapshot timestamp, commands/tool versions, checksums and access controls. Verify required Auth data, private tables/functions, RLS, ownership/grants, sequences, migration metadata and extensions; do not print sensitive records. Role credentials, managed keys/configuration and Storage bytes need separate handling.
3. Restore only to a newly created local disposable, compatible environment. Block egress, disable background scheduling/workers before data import, avoid production credentials/URLs and verify that the connection target is local. Do not use restore-to-production tooling. Resolve managed-role/extension/service versions without suppressing failures.
4. Verify the **pre-migration** restore independently: schema/constraints/grants/policies/function inventories; table counts and financial totals from the same source snapshot; foreign keys and sequence state; approved Auth behavior; and separately backed-up file-byte hashes against metadata. Keep source and target manifests separate. A synthetic fixture roundtrip would prove tooling only, not London recovery.
5. On that isolated target, register/apply the exact three reviewed proposals and exercise their interaction: contact save/audit/conflict without login changes; tenant/manager/foreign-block boundaries for contact/history and account sign-ins; client Save/Review/Issue/Void/replay gates; unchanged resident/supplier ledgers; old archive/import writes receiving contact audit; and no real email/payment effects. Test the known distinction between account sign-in and portal activity.
6. Test feature withdrawal independently. Invoice database writes/issuing stay false initially; app flags do not freeze direct RPCs. Resident editing/sign-in functions require their own privilege withdrawal if needed. Prefer retaining additive history/schema over destructive rollback. Confirm no loss of unrelated data and no external dispatch.

Blockers remain: securely provisioned database/Storage backup access, approved encrypted local handling, compatible isolated stack, execution authorization for the restore/migration drill, and actual successful recovery/combined database/end-to-end evidence. The integrated code branch is ready to support that drill, but is not a deployment recommendation. Production migration/deployment approval remains withheld.
