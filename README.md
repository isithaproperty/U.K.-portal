# London Property Portal

Next.js 16 application for Vercel, with Supabase authentication and a block-scoped resident register. This is a separate codebase from the existing Sites portal.

## Setup

1. Create a dedicated Supabase project and run `supabase/schema.sql` in its SQL editor. For an existing project that already has the original schema, apply `supabase/unit_residents.sql` as a migration.
2. Import the separately held 84-row block seed into that project's `blocks` table and grant the owner membership. Keep this seed outside the public repository.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in Vercel, using the new project's values.
4. Add the Vercel URL to Supabase Auth's redirect allowlist, with `/auth/callback`. Sign in with the email granted membership in the private seed.

Run `npm ci && npm run build` locally. The app uses Supabase Row Level Security: managers see the portfolio; a resident sees only the block and unit assigned to their verified email. Sign-in alone does not grant access.

Managers can choose a block under **Units & residents**, add one unit at a time, or upload a CSV using the built-in template. The columns are `unit_number,resident_name,resident_email,phone`. Repeat a unit number for multiple residents; leave the last three columns empty to create an unassigned unit. Importing the same unit and email updates that assignment without deleting anyone else. The import is atomic and capped at 500 rows. Resident contact details are stored in Supabase and must not be committed to this public repository. No unit or resident test records are seeded.

Residents receive a sign-in link from the portal's login page after the managing team imports their email. Their portfolio and building list are filtered at the database level. Other management modules start empty and are not connected to data yet.

## Tenant portal

Apply `supabase/tenant_portal.sql` once on the existing project. Registered residents sign in at `/tenant/login` and are directed to `/tenant`, where they see their home and report or track maintenance requests. Tenants cannot access management costs, internal work-order notes, other residents or building safety information. Managers can preview a resident from Units & residents and respond to tenant requests under Work orders. The preview is read-only. The database enforces resident assignments and manager portfolio scope. Test resident details stay in the database and are never seeded into source.

## Service charges

Apply `supabase/service_charges.sql` once. Management can raise charges or record payments and credits under Service charges or a building’s service charge tab, and import up to 500 CSV entries atomically. A reference identifies an entry within its unit and type; reimporting it corrects the record. Residents see only their own unit account. Balances use posted entries as of the London date; payments and credits settle the earliest due charges first. No live financial amounts are seeded.
