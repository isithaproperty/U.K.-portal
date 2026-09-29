# London Property Portal

Next.js 16 application for Vercel, with Supabase authentication and a private block register. This is a separate codebase from the existing Sites portal.

## Setup

1. Create a dedicated Supabase project and run `supabase/schema.sql` in its SQL editor.
2. Import the separately held 84-row block seed into that project's `blocks` table and grant the owner membership. Keep this seed outside the public repository.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in Vercel, using the new project's values.
4. Add the Vercel URL to Supabase Auth's redirect allowlist, with `/auth/callback`. Sign in with the email granted membership in the private seed.

Run `npm ci && npm run build` locally. The app uses Supabase Row Level Security: only signed-in members can read the block register. Other modules start empty and are not connected to data yet.
