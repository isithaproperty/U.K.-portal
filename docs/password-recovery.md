# Password recovery

`/login` and `/tenant/login` link to `/forgot-password`. Requests use the publishable Supabase client on the server and `resetPasswordForEmail`; they do not create accounts. Every validly formed request gets the same generic response, including provider/rate-limit failures. Supabase's own Auth rate limits remain authoritative.

## Required production verification

No Supabase configuration or email templates are changed by this implementation. Before declaring reset delivery operational, verify the project's Auth redirect allowlist includes the exact production URL `https://<portal-host>/auth/recovery/callback` and the recovery email template uses `{{ .ConfirmationURL }}`. Supabase's standard confirmation URL supports the PKCE flow used here. An incompatible template or disallowed redirect can fall back to the Site URL and prevent recovery. This cannot be established from the available public configuration.

An explicitly customized token-hash template can instead target `https://<portal-host>/auth/recovery/callback?token_hash={{ .TokenHash }}&type=recovery`. No template change is needed for the standard PKCE template. Any setting changes must be separately authorized.

No privileged key, new signing secret, database changes or new dependencies are required.

## Flow and boundaries

- The server stores the PKCE verifier in separate HttpOnly, SameSite=Lax cookies scoped to `/auth/recovery`. Secure cookies are used in production. They expire after 15 minutes. PKCE email links must open in the requesting browser.
- The callback page reads the recovery code (or explicit recovery token hash) into memory and immediately removes the query and fragment from browser history. No token is stored in local/session storage or application logs. Recovery responses disable caching and referrers. Hosting/proxy infrastructure can still log incoming request URLs; operators should redact auth URLs in any access-log/export configuration.
- The token is exchanged only when the user submits a new password. Existing authenticated sessions are never accepted as recovery proof. PKCE exchange must return the SDK's recovery redirect type; token hashes are verified with `type: recovery` only.
- Completion validates 12–128 character passwords and matching confirmation before consuming the link; Supabase enforces its configured password policy. A provider rejection after exchange consumes the one-use link and requires a fresh request. Refreshing the completion page also requires a fresh link by design.
- Only the isolated recovery session is signed out after completion. Existing ordinary portal sessions are neither overwritten nor globally signed out. Recovery cookies are cleared on completion and invalid exchange.
- POST routes require an exact same-origin Origin header. Callback and completion never use user-supplied redirects. Normal contractor magic-link login remains unchanged.

## Verification

`npm test`, `npm run typecheck`, and `npm run build` validate the implementation without sending email or changing any account. Recovery route tests mock Supabase and cover one-use exchange order, wrong/missing recovery context, invalid/expired links, password validation, generic request feedback, policy rejection, and local-only sign-out.

A real delivery and reset smoke test must be initiated by the account owner, who opens the email and chooses their own password. Do not request, expose or select that password on their behalf.
