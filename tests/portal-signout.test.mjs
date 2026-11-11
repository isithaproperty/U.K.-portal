import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('management sign out is visible in header and sidebar and limited to this session',()=>{
 const source=readFileSync(new URL('../app/Portal.tsx',import.meta.url),'utf8');
 assert.match(source,/auth\.signOut\(\{scope:"local"\}\)/);
 assert.match(source,/className="outline header-sign-out" disabled=\{signingOut\}/);
 assert.match(source,/className="sign-out" disabled=\{signingOut\}/);
 assert.match(source,/if\(error\)throw error;window\.location\.replace\("\/login"\)/);
});
test('sidebar can scroll and narrow header keeps account control',()=>{
 const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');
 assert.match(css,/\.sidebar\{overflow-y:auto/);
 assert.match(css,/\.header-sign-out\{[^}]*flex-shrink:0/);
});
