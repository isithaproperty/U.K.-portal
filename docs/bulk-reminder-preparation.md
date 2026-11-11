# Private bulk reminders: local queue implementation

## Staff flow

In **Debtors**, expand **Bulk reminder emails** for the selected building. No new tab is added.

1. Choose **Overdue only** (default) or explicitly choose **Friendly outstanding-balance notice**. Refresh accounts and confirmed leaseholder recipients.
2. Review eligible/excluded accounts, amounts and recorded dates. Select accounts and review/edit the common subject/message.
3. Preview each private message. The server rereads the atomic building ledger/contact snapshot. Stale selections are rejected. Each message has one To address, only its unit’s summary and one private PDF account statement, with no CC/BCC. Up to 1,000 messages and a 2 MB total preview payload; larger batches fail with select-fewer guidance.
4. Separately approve **queueing the exact messages** and accept the explicit confirmation. A signed ten-minute proof binds manager, building, authoritative source and exact batch. The queue rereads/validates again and accepts the whole batch atomically. Changing the message, recipients or balance requires preview again.
5. Check individual states: Pending is queued, not sent; Sent means provider acceptance; Delivered requires separate provider evidence. Queueing itself makes no provider request. With transport disabled, records remain pending. Existing **Delivery queue & exact history** handles permitted processing/reconciliation.

An in-app staff callout flags only recorded amounts due strictly before today, and clears when refreshed ledger payments/credits clear them. It labels its loaded snapshot and requires current review before action. Historical demand-send evidence is described as potentially relating to different charges; absent history is not treated as proof of issue. This is not a scheduled reminder, browser notification or automatic email.

The optional manager-only review export contains snapshot/messages only, never the signing token. It must not be emailed to residents. Export approval is distinct from queue approval. Navigation does not undo a queue transaction: the panel records an unresolved-attempt marker in session storage, disables its parent building/reload controls while awaiting queue outcome, and asks staff to inspect history before a fresh attempt if the response is lost.

## Reusable wording, personalization and resident upload review

The common subject and message accept `{name}`, `{unit}`, `{building}` and `{portal}`. The fixed portal value is the verified homepage `https://london-property-portal.vercel.app`; no guessed account-specific link, token or access grant is generated. Default messages include a personal greeting and invite the recipient to sign in to review account status, with a contact-the-team fallback for access problems.

Names are resolved from confirmed financial-permitted leaseholder contacts for the **exact unit and email address**. If a shared email has conflicting names, the preview uses the neutral greeting “Hello there” rather than guessing. Each private message is rendered separately, then the exact expanded name/text/link participates in the existing approval proof and idempotency key. Contact/name changes invalidate stale approval.

**Save wording for this browser** stores only subject/template text in local browser-profile storage, keyed by selected building and reminder mode. **Load saved wording** explicitly reloads it and invalidates existing message approval. It is not server persistence, not synced to other devices, and not a shared staff template. Anyone using the same browser profile may access saved wording; avoid personal details. No recipient list, rendered names or approval proof is added automatically. Unsupported/invalid fields are rejected; saved wording must still be previewed and approved for every batch.

Resident CSV upload already stores `resident_name` and `resident_email` as resident/portal-assignment data. It does **not** establish leaseholder status or financial-message permission. In existing **Contacts and Section 20 review**, **Review uploaded resident details** now prefills a current scoped resident’s unit, name and email into the existing form, while clearing contact type and both permission checkboxes. Staff must explicitly confirm type, financial-message permission, add the contact draft and use **Save block records**. Only those confirmed saved financial recipients can enter bulk reminders. Existing records and resident portal access are not changed merely by prefill.

## Eligibility and privacy

- Overdue requires a positive recorded unpaid amount with due date strictly before today (Europe/London). Due today is not overdue.
- Friendly notices include positive unpaid/part-paid balances, including future-due amounts. Wording does not claim those amounts are late or requested early. Missing due dates do not establish a deadline.
- Payments/credits settle oldest-due charges using the existing allocation basis. Paid/credit accounts are excluded.
- Only saved Leaseholder contacts permitted to receive financial messages qualify. Resident assignments never establish ownership. Missing permissions/contacts are shown separately from no-overdue reasons.
- Distinct `Overdue account reminder` / `Friendly balance notice` kinds do not masquerade as First/Final reminders or issued demands. No prior demand delivery is asserted. Staff must review any edited common wording for accuracy.

## Database and submission safety

The local `supabase/bulk_reminder_dispatch.sql` migration adds a building revision and serialized snapshot RPC. Ledger, unit, building and leaseholder-source changes increment the revision. No supplier/work-order dependency remains. Queue and claim check revision, London date, account eligibility, manager scope and recipient permission under the same building lock.

A separate generic-bulk claim RPC prevents legacy workers accidentally claiming these new kinds. Immediately before a provider request, the worker verifies the exact claim token and current source/recipient again. The claim has a two-minute lease, with at least 45 seconds remaining required by the final check; a verification response taking over ten seconds is rejected before transport. Provider requests retain a fifteen-second timeout.

During active submission, changes to the affected unit’s ledger/unit record are briefly deferred; building/contact changes defer for any active generic-bulk submission in that building. Unrelated unit payments are allowed, but conservatively invalidate still-pending batch previews through the building revision. Staff receive an actionable retry message. Expired claims become Uncertain before edits are allowed, never automatically resent. An explicit **Recover expired bulk submissions** action in Delivery history performs that expiry without editing an account or enabling transport; only claims older than two minutes change, then normal uncertainty reconciliation applies. No finite lease can prove non-acceptance after a transport timeout; reconcile uncertain provider outcomes.

Keys are deterministic per exact unit/recipient/content/source, independent of selected batch membership or order. A durable same-day constraint prevents another Pending/Sending/Sent/Uncertain reminder for that unit/address across both generic modes. Exact retries return existing immutable rows, not another email. A newly reviewed corrected operation may replace definitively unsent Failed/Cancelled records; prior audit remains. The atomic snapshot also lists same-day protected unit/address records. Those addresses are visibly excluded from fresh messages, allowing a newly reviewed failed joint-address sibling to proceed without resending the accepted recipient. Sent/Uncertain records cannot be replaced this way. Next-day records need a new current-date preview.

## Installation and activation: not performed

This implementation and SQL are **local and unpublished**. No live migration, queue, email, settings, permissions or activation changes were performed.

Prerequisites for a separately approved rollout:

- Review/apply `supabase/bulk_reminder_dispatch.sql` after the existing management dispatch schema, with explicit migration/permission-change approval. It grants manager-scoped snapshot reads and service-role-only guarded queue/claim/verify functions, not arbitrary manager writes.
- Existing Supabase URL/publishable key, manager membership and confirmed leaseholder permissions must be configured. Existing `SUPABASE_SERVICE_ROLE_KEY` is required server-side for approval signing and guarded queue operations; never expose it to client code or exports.
- Review sender/domain authorization, provider configuration (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, optional reply-to), operational suppression/bounce practices and existing delivery evidence/reconciliation controls before external sending.
- Both `LONDON_DELIVERY_ENABLED=1` **and** the new separate `LONDON_BULK_REMINDER_DELIVERY_ENABLED=1` are required for generic-bulk submission. Neither flag was changed here. Scheduled worker execution additionally requires its existing jobs/cron setup; no new automation was created.
- Queue approval is approval for those exact emails once delivery is enabled. Activate transport only with explicit authorization and an operational check for pending records. Never treat preparing, previewing or installing the feature as permission to contact recipients.

## Verification

Synthetic tests only. Node tests cover balances, contacts/privacy, proof binding/expiry, stable per-message keys, API gating/stale state, worker revalidation/default-off transport, uncertainty, and mock-hook UI flows. Isolated PGlite tests exercise real PostgreSQL migration functions for atomic snapshots/queueing, role scope, same-unit guards, other-unit changes, lease expiry, duplicate protection and safe failed replacement. These are not live database or authenticated browser tests. A synthetic standalone HTML preview accompanies the source bundle; it is not a production screenshot.

## Private statement attachment

A new deterministic account statement is generated from the complete authoritative ledger for the selected unit at preview. It includes the entire recorded history through the as-of date, opening zero, each charge/payment/credit and running balance, closing balance, due and overdue amounts, recorded due dates and account reference. No internal notes, inferred resident ownership or other units are included. It is not a new demand and does not add deadlines or fees. Previously issued historical documents and ledger rows are never edited.

The manager can read the exact statement text and download its PDF before ticking the explicit message-and-statement approval checkbox. Filename, type, encoding, exact PDF bytes and unit/building/date/hash evidence bind the approval and durable per-recipient key. Queueing rebuilds deterministically from a fresh authoritative source and requires the original exact approval. Changing ledger, contacts or London date requires regeneration and reapproval; no attachment is silently replaced. Submission checks source revision, date, scope and decoded PDF SHA-256 again under the bounded claim guard, then transmits the already approved immutable bytes.

No new PDF dependency was added. Standard WinAnsi text is supported; unsupported characters/control characters fail preparation with an explicit error rather than silently corrupting a statement. Very large statements/batches fail closed. Pagination can split a transaction over pages. A synthetic sample PDF is included for review.

History returns at most 500 metadata rows, not all stored PDFs. The existing history panel fetches one exact private email/document record on demand with building scope checks and stale-navigation guards. Recovery remains available independently of the truncated history. No live send, queue mutation, migration or flag activation was performed.
