import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { passwordError, REQUEST_MESSAGE } from "../lib/password-recovery.ts";
function loadRoute(name, deps) {
  const source = readFileSync(new URL(`../app/auth/recovery/${name}/route.ts`, import.meta.url), "utf8").replace(/^import[^\n]*\n/gm, "").replace("export async function POST", "async function POST");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(deps), `${js}; return POST;`)(...Object.values(deps));
}
function harness(options = {}) {
  const calls = [];
  const NextResponse = { json(body, options = {}) { return { body, status: options.status || 200, cookies: { getAll: () => [], set() {} } }; } };
  const client = { auth: {
    exchangeCodeForSession: async (_code, flow) => { calls.push(flow ? ["exchange", flow.flowId] : "exchange"); return { data: { session: options.noSession ? null : {}, redirectType: options.kind || "recovery" }, error: options.exchangeError }; },
    verifyOtp: async args => { calls.push(["verify", args.type]); return { data: { session: {} }, error: options.exchangeError }; },
    updateUser: async () => { calls.push("update"); return { error: options.updateError }; },
    signOut: async args => { calls.push(["signOut", args.scope]); return {}; },
    resetPasswordForEmail: async (email, args) => { calls.push(["request", args.redirectTo]); if (options.throwRequest) throw new Error("private provider failure"); return { error: options.requestError }; }
  } };
  const deps = { NextResponse, passwordError, REQUEST_MESSAGE, privateResponse: r => r, sameOrigin: () => !options.crossOrigin, recoveryClient: () => client, clearRecovery: () => calls.push("clear") };
  return { calls, invoke: (body, name = "complete") => loadRoute(name, deps)({ nextUrl: new URL("https://portal.example/auth/recovery/request"), json: async () => body }) };
}
const valid = { password: "a unique passphrase", confirmation: "a unique passphrase", code: "test-code" };
test("password length and confirmation validated without trimming", () => {
  assert.ok(passwordError("short", "short")); assert.ok(passwordError("a".repeat(129), "a".repeat(129)));
  assert.ok(passwordError(valid.password, "different")); assert.equal(passwordError(" ".repeat(12), " ".repeat(12)), null);
});
test("PKCE recovery exchanges before updating then revokes only local recovery session", async () => {
  const h = harness(); assert.equal((await h.invoke(valid)).body.success, true);
  assert.deepEqual(h.calls, ["exchange", "update", ["signOut", "local"], "clear"]);
});
test("token hash requires explicit recovery type and verified one-use token", async () => {
  const h = harness(); assert.equal((await h.invoke({ ...valid, code: undefined, token_hash: "hash", type: "recovery" })).status, 200);
  assert.deepEqual(h.calls[0], ["verify", "recovery"]);
  const wrong = harness(); assert.equal((await wrong.invoke({ ...valid, code: undefined, token_hash: "hash", type: "email" })).status, 400); assert.deepEqual(wrong.calls, []);
});
test("missing, mixed, stale, non-recovery and failed exchanges cannot update a password", async () => {
  for (const body of [{ ...valid, code: undefined }, { ...valid, token_hash: "hash" }, { ...valid, code: 123 }]) {
    const h = harness(); assert.equal((await h.invoke(body)).status, 400); assert.equal(h.calls.includes("update"), false);
  }
  for (const options of [{ kind: "signin" }, { noSession: true }, { exchangeError: { message: "expired" } }]) {
    const h = harness(options); assert.equal((await h.invoke(valid)).status, 400); assert.equal(h.calls.includes("update"), false);
  }
});
test("cross-origin and invalid password submissions cause no auth operation", async () => {
  const h = harness({ crossOrigin: true }); assert.equal((await h.invoke(valid)).status, 403); assert.deepEqual(h.calls, []);
  const bad = harness(); assert.equal((await bad.invoke({ ...valid, confirmation: "different" })).status, 400); assert.deepEqual(bad.calls, []);
});
test("provider policy failures require a new link and discard the recovery session", async () => {
  const h = harness({ updateError: { message: "private" } }); const response = await h.invoke(valid);
  assert.equal(response.status, 400); assert.equal(response.body.invalid, true); assert.ok(!JSON.stringify(response.body).includes("private"));
  assert.deepEqual(h.calls.slice(-2), [["signOut", "local"], "clear"]);
});
test("reset request response is identical for known, unknown, failed and invalid emails", async () => {
  for (const options of [{}, { requestError: {} }, { throwRequest: true }]) {
    const h = harness(options); const r = await h.invoke({ email: "user@example.invalid" }, "request");
    assert.deepEqual(r.body, { message: REQUEST_MESSAGE }); assert.equal(r.status, 200);
    assert.deepEqual(h.calls[0], ["request", "https://portal.example/auth/recovery/callback"]);
  }
  const h = harness(); assert.equal((await h.invoke({ email: "bad" }, "request")).body.message, REQUEST_MESSAGE); assert.deepEqual(h.calls, []);
});
test("recovery UI never persists credentials and strips history; normal sign-in remains", () => {
  const ui = readFileSync(new URL("../app/reset-password/page.tsx", import.meta.url), "utf8");
  assert.match(ui, /history\.replaceState/); assert.doesNotMatch(ui, /localStorage|sessionStorage|console\./);
  const server = readFileSync(new URL("../lib/supabase/recovery.ts", import.meta.url), "utf8");
  assert.match(server, /httpOnly: true/); assert.match(server, /sameSite: "lax"/); assert.doesNotMatch(server, /SERVICE_ROLE|AUTH_RECOVERY_SECRET/);
  assert.match(readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8"), /signInWithPassword/);
});

test("flow identifiers select the original PKCE verifier and malformed identifiers fail closed", async () => {
  const h = harness(); assert.equal((await h.invoke({ ...valid, flowId: "test_flow_1234" })).status, 200);
  assert.deepEqual(h.calls[0], ["exchange", "test_flow_1234"]);
  for (const flowId of ["short", "bad/flowid", 123, "a".repeat(65)]) {
    const bad = harness(); assert.equal((await bad.invoke({ ...valid, flowId })).status, 400); assert.deepEqual(bad.calls, []);
  }
});
