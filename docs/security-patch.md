# Next.js security patch

On 2026-11-11, the official npm registry audit identified three advisories affecting the pinned Next.js 16.4.0 package:

- GHSA-2464-fhr4-w9xw: unauthenticated remote code execution in Image Optimization API when SVG files are used (critical).
- GHSA-p3m5-59mp-jv5r: denial of service in App Router using Server Actions (high).
- GHSA-673q-mjm6-r5xr: unauthenticated remote code execution in use-cache functions returning typed arrays (critical).

The registry reported affected versions through 16.4.0 and recommended the stable 16.4.6 patch. Updated only Next.js and its matching bundled dependencies in package.json/package-lock.json. React and React DOM remain 19.2.6, satisfying the patched Next.js peer requirements. Node 24.22.1 satisfies its Node >=20.9.0 requirement. No application codemod or major/minor framework migration was required.

Verification after installation: npm audit reports zero known vulnerabilities; npm run typecheck passes; npm ls confirms Next.js 16.4.6 and unchanged React versions. The parent runs aggregate tests and production build before publication. This audit result does not establish absence of every vulnerability or evidence about prior exploitation.

Sources: https://github.com/advisories/GHSA-2464-fhr4-w9xw ; https://github.com/advisories/GHSA-p3m5-59mp-jv5r ; https://github.com/advisories/GHSA-673q-mjm6-r5xr ; official npm registry metadata for next@16.4.6.

No production deployment, database write, account change or external message occurred during this remediation.
