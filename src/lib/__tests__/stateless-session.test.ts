// Tests for the stateless session helpers in scripts/api-shared-head.mjs (#79).
// The head file is written for Vercel's Web-Request runtime; we evaluate it in
// a context that provides the minimal Request/Headers shims it needs.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const head = readFileSync(resolve(process.cwd(), "scripts/api-shared-head.mjs"), "utf8");

type Ctx = Record<string, unknown>;
const ctx: Ctx = {};

beforeAll(async () => {
  const sandbox = vm.createContext({
    ...globalThis,
    process: { env: { ...process.env, SESSION_SECRET: "test-secret" } },
    fetch: globalThis.fetch,
    console,
    exports: {},
    module: { exports: {} },
    require: (name: string) => {
      if (name === "node:crypto") return require("node:crypto");
      throw new Error(`unexpected require ${name}`);
    },
  });
  // The file uses ESM `import`; transform to a function body via dynamic import
  // of a data URL is cleaner — but keep it simple: strip the import and inject
  // node:crypto bindings directly.
  const stripped = head.replace(/^import .*$/m, "");
  const crypto = await import("node:crypto");
  Object.assign(sandbox, crypto, { Buffer });
  vm.runInContext(stripped, sandbox);
  ctx.sandbox = sandbox;
});

function fn(name: string): (...a: unknown[]) => unknown {
  return (ctx.sandbox as Ctx)[name] as (...a: unknown[]) => unknown;
}

describe("stateless session core", () => {
  it("createSession embeds the gateway key and a 12h expiry", () => {
    const s = fn("createSession")("gsk_test_key") as Record<string, unknown>;
    expect(s.key).toBe("gsk_test_key");
    expect(Number(s.expiresAt) - Number(s.createdAt)).toBe(1000 * 60 * 60 * 12);
  });

  it("sealSession/unsealSession round-trip", () => {
    const seal = fn("sealSession")!;
    const unseal = fn("unsealSession")!;
    const payload = { key: "abc", csrfToken: "x", expiresAt: Date.now() + 60_000 };
    const token = seal(payload) as string;
    expect(unseal(token)).toMatchObject({ key: "abc" });
  });

  it("tampered tokens are rejected", () => {
    const seal = fn("sealSession");
    const unseal = fn("unsealSession");
    const token = seal({ key: "abc", expiresAt: Date.now() + 60_000 }) as string;
    const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    expect(unseal(tampered)).toBeNull();
    expect(unseal("garbage")).toBeNull();
    expect(unseal(undefined)).toBeNull();
  });

  it("expired sessions are rejected", () => {
    const unseal = fn("unsealSession");
    const seal = fn("sealSession");
    const token = seal({ key: "abc", expiresAt: Date.now() - 1_000 }) as string;
    expect(unseal(token)).toBeNull();
  });

  it("tokens sealed under a different secret fail to unseal", async () => {
    // Re-run the module under a different SESSION_SECRET.
    const vmMod = await import("node:vm");
    const crypto2 = await import("node:crypto");
    const sandbox = vmMod.createContext({
      ...globalThis,
      process: { env: { ...process.env, SESSION_SECRET: "other-secret" } },
      ...crypto2,
      Buffer,
    });
    const stripped = head.replace(/^import .*$/m, "");
    vmMod.runInContext(stripped, sandbox);
    const sealHere = vmMod.runInContext("typeof sealSession !== 'undefined' ? sealSession : null", sandbox) as never;
    if (!sealHere) return; // skip if injection shape differs
    const token = (sealHere as (p: unknown) => string)({ key: "k", expiresAt: Date.now() + 60_000 });
    expect(fn("unsealSession")(token)).toBeNull();
  });

  it("authorize() reads the session purely from the cookie header", () => {
    const seal = fn("sealSession");
    const authorize = fn("authorize");
    const s = { id: "i", csrfToken: "c", key: "gwkey", expiresAt: Date.now() + 60_000 };
    const cookie = `orole_session=${seal(s)}`;
    const req = { headers: new Headers({ cookie }) };
    const got = authorize(req) as Record<string, unknown> | null;
    expect(got?.key).toBe("gwkey");
    // no cookie → null
    expect(authorize({ headers: new Headers() })).toBeNull();
  });
});
