import test from "node:test";
import assert from "node:assert/strict";
import { safeAuthRedirect } from "../lib/auth-redirect.ts";

const origin = "https://portal.example";
test("keeps local destinations, query strings and fragments", () => {
  for (const path of ["/tenant", "/tenant?tab=charges#balance", "/work-orders/42", "/tenant?name=Mary%20Smith"]) {
    assert.equal(safeAuthRedirect(path, origin).href, origin + path);
  }
});
test("rejects external origins, backslashes and control characters", () => {
  for (const path of [null, "", "https://attacker.example", "//attacker.example", "/\\attacker.example/path", "/\t/attacker.example/path", "/\n/attacker.example", "///attacker.example", "/tenant\u0000", "tenant"]) {
    assert.equal(safeAuthRedirect(path, origin).href, origin + "/");
  }
});
test("encoded path characters cannot change the redirect origin", () => {
  for (const path of ["/%2f%2fattacker.example", "/%5cattacker.example", "/%09/attacker.example"]) {
    assert.equal(safeAuthRedirect(path, origin).origin, origin);
  }
});
