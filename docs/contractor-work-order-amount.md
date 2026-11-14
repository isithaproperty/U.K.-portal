# Contractor work-order amount

Separate from the pending client-invoice feature. Based on main `db1b2dd`.

The work-order document, new dispatch snapshot and outgoing email now include the same amount. An explicitly approved or paid work order uses its approved cost and labels it Agreed. Otherwise its estimate is labelled Estimated. Unapproved internal actual costs are not exposed as an agreed amount. Missing or malformed amounts remain Not recorded. Ongoing orders label the amount as a contract total and explain that an annual contract total is not each monthly invoice amount. VAT treatment is not inferred.

The management document uses the current authorized order record. Contractor documents use their saved dispatch snapshot. Existing historical snapshots and emails are not rewritten, supplemented with today's amount, or resent automatically; old snapshots explicitly show that the amount was not recorded. The prior already-sent/idempotency guard remains in place. The removed Actual Amount work-order controls remain removed.

Read-only production metadata confirmed the required existing numeric costs, payment status, ongoing flag and JSON dispatch snapshot. The deployed edge-function source was compared byte-for-byte with the repository baseline before editing. No SQL or database migration is needed. Function authentication stays at verify_jwt=true and the existing management/contractor authorization is preserved.

Verification: 258 tests passed, including amount selection, missing/invalid amounts, ongoing annual-versus-monthly wording, document rendering and an edge send-path test with synthetic database/email transports only. Typecheck and production build passed. No real email, dispatch, work order or financial record was created or changed during testing.

Deployment consists of the Vercel application and the `work-order-workflow` Supabase Edge Function, including `_shared/work-order-amount.ts`. No migration or permission change is involved. A real send remains an explicit user action; no live send is used for release health checks.
