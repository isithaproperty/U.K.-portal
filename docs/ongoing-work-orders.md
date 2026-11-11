# Ongoing work orders

Choose **One-off job** (default) or **Ongoing works / recurring contract** when raising a work order. Existing orders remain one-off. Mode cannot be changed later to bypass ordinary completion controls.

An ongoing order can receive multiple saved supplier invoices. Enter a positive approved cost and approve the active order. Only the portfolio owner records actual bank settlements, using the existing evidence, allocation, revision and duplicate-payment checks. Paying an invoice never closes an ongoing order or marks the entire contract Paid. Each invoice shows its own payment status; the ongoing order remains Approved.

Use **Close ongoing works** after all saved invoices settle. Scoped staff may close it; database checks block reopening or adding/changing invoices afterward. Raise a fresh order for the next contract. Existing settled cost, supplier and block immutability remains. Approved cost is not a new annual budget ceiling; budget mapping/reporting is separate.

## Migration and rollback

Apply `supabase/ongoing_work_orders.sql` after `supabase/supplier_settlements.sql`, before serving the updated application. It adds `is_ongoing` and replaces two functions plus the creditor trigger, without widening grants or row-level policies.

Before production application, verify a current restorable database backup and capture the existing settlement and creditor function/trigger definitions. Record table counts and existing work-order modes. Inspect migration history to avoid duplicate application. The script runs atomically. Existing rows receive false; no invoices, settlements or messages are created.

An app rollback may retain the additive column. Do not blindly restore old settlement functions or drop the column once ongoing orders exist: that would erase lifecycle meaning or prevent future recurring settlement. In that case retain the migration and fix forward, or use a reviewed data-aware recovery plan. Preserve new invoices and immutable settlement history.

## Verification

Run `npm run typecheck`, `npm test`, and `PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node tests/run-pglite-ongoing-work-orders.mjs`.

The disposable SQL test covers ordinary payment regression assertions, immutable work type, authorization, two monthly invoices, partial payment, replay, explicit closure, rejection of reopening, and closed-order invoice guards including a first creditor save. It uses no hosted database or real bank payments. Test the combined UI before publication.
