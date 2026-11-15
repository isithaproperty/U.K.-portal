# London recovery prerequisites — read-only assessment

The supplied screenshot shows daily physical snapshots, latest **14 November 2026 07:34:34 UTC**, and warns that Storage objects are excluded. The project identity is not visible. It does not establish that this is London's backup or that any restore has been tested. No restore, backup creation, PITR activation, database migration or deployment was performed.

The connected project was independently verified as **London Property Portal**, ref `yhyqxvbquavhndxcwttt`, region `eu-west-2`, ACTIVE_HEALTHY, PostgreSQL 17.6.1.166. Open the identified project's [backup page](https://supabase.com/dashboard/project/yhyqxvbquavhndxcwttt/database/backups) to bind backup evidence to that exact ref. This identity check cannot bind the unlabelled screenshot by itself.

At 15 November 2026 01:39:11 UTC, the London database reported archive_mode on, archive_timeout 2min, last archived WAL at 01:22:08 UTC, failed_count 0, last_failed_time null, statistics reset 25 August 2026. These observations show WAL archival activity; they do not verify a usable managed base backup, PITR entitlement/retention, recoverable start/end timestamps or restore success. Available connected tools expose no backup inventory/PITR-status operation; no authorized management API credential was available. The restore tool was deliberately not invoked as a probe.

London's Storage metadata contains four private buckets: contractor-documents, building-safety-documents, work-order-documents and staff-work-order-documents, with six stored object records at inspection. Object contents were not downloaded or changed. Database/WAL recovery alone does not protect those file contents; metadata counts do not prove object backup or integrity. See Supabase's [database backup documentation](https://supabase.com/docs/guides/platform/backups).

Before either proposed migration is approved:

1. Confirm a successful backup belongs to `yhyqxvbquavhndxcwttt`, record timestamp/status/retention and any PITR window from the identified dashboard or authorized management API. Verify the backup predates the planned change and supports the chosen rollback/recovery target. Screenshot recency alone is insufficient.
2. Verify independently restorable copies and integrity of Storage object bytes plus paths/metadata for all four buckets. Preserve relevant deployment source/configuration and recoverable secrets securely; do not put credentials in this report.
3. Document restoration permissions, operational owner, downtime/data-loss objectives and the procedure for reconciling database metadata with object contents. An actual production restore is destructive and requires separate explicit authorization.
4. Test recovery to an isolated permitted environment without sending notifications or connecting restored data to production financial/email integrations. Verify object downloads, Auth/access scope, audit history, financial totals and references. No such drill has been performed here.
5. Recheck backup identity/status and schema immediately before any approved migration. For feature rollback, prefer preserving additive schema/data and disabling new write access over restoring the entire project and losing unrelated subsequent activity.

Unresolved: screenshot project identity, London snapshot inventory, PITR entitlement/window, independent Storage backup and an isolated restore test. Consequently recovery readiness is not yet established and neither client-invoice nor resident-contact migration has been applied.
