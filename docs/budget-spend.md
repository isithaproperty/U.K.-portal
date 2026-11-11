# Annual budget versus spending

Service charges → Budget vs spend loads the saved building budget category summaries and the complete supplier-invoice/verified-settlement history through its annual year end. Import and explicitly save all budget schedules in Budget & financials first. Each work order can then be allocated to one category for that budget year. Unallocated invoices stay visible in a separate row.

Invoiced spending uses the invoice date, not order creation date, estimate, approved annual cost, status, or editable payment drafts. Prior-year orders therefore continue to contribute monthly invoices. Remaining budget is annual budget minus invoiced spending and may be negative. Payments are counted separately by verified settlement date, including payments of invoices from prior years. Multi-invoice payments can span categories without being discarded or counted twice. No prediction or accrual is inferred: before year end the comparison is an interim recorded total. Incomplete/invalid settlement evidence produces explicit warnings and is excluded from paid totals; overallocations fail closed.

Category assignment changes are previews until explicitly saved. Saving uses the existing manager-scoped, optimistic-revision and audit-history controls. A year/category change requires assignments to be reviewed again. Past revisions remain in management_review_history; there is not yet an interactive prior-budget-year selector. Changing building clears the loaded snapshot. Refresh after subsequent invoices or payments. No financial records or messages are created by loading or saving assignments.

## Deployment prerequisites

Apply `supabase/budget_spend.sql` after the existing management review migrations; it adds the `budget-spend` review area and leaves roles and row policies unchanged. Apply `supabase/ongoing_work_orders.sql` separately for ongoing-order lifecycle, as documented in ongoing-work-orders.md. Deploy both reviewed files with the integrated UI. Neither migration contains production records, messages, or payment transactions. Check current recovery point and current schema before execution. Retain previous source for application rollback; do not blindly remove additive columns or delete saved state as rollback.

## Reconstruction verification

This implementation was rebuilt from the verified GitHub baseline and documented requirements after earlier unpushed local source became unavailable. It is not a byte-for-byte recovery. Unit tests cover invoice-versus-order totals, cross-year and cross-building isolation, monthly running spending, split verified payments, incomplete evidence, overpayment rejection, negative remaining budgets, leap dates, budget identity and category mismatch. Additional database integration, build, and browser checks must be recorded with the final release outcome rather than inferred from these tests.
