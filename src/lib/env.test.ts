import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPublicEnv, getServerEnv, isPublicEnvConfigured, resetServerEnvCache } from "./env";

/**
 * Supabase renamed its API keys (anon -> publishable, service_role -> secret).
 * These tests pin the alias resolution and the "pasted a URL instead of a key"
 * guard, which is the failure mode that produced a silently-green doctor.
 */

const MANAGED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_APP_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "FIRECRAWL_API_KEY",
  "FIRECLAW_API_KEY",
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "LLM_MODEL",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "ADMIN_EMAIL",
  "CRON_SECRET",
] as const;

const original = new Map<string, string | undefined>(MANAGED.map((key) => [key, process.env[key]]));

const SUPABASE_URL = "https://demo-project.supabase.co";

const validServerEnv = {
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_server_side",
  FIRECRAWL_API_KEY: "fc-test",
  LLM_API_KEY: "sk-test",
  RESEND_API_KEY: "re-test",
  EMAIL_FROM: "Reportes <reportes@acme.com>",
  ADMIN_EMAIL: "equipo@acme.com",
  CRON_SECRET: "c".repeat(32),
};

function setEnv(vars: Record<string, string>): void {
  for (const key of MANAGED) delete process.env[key];
  Object.assign(process.env, vars);
  resetServerEnvCache();
}

beforeEach(() => {
  setEnv({});
});

afterEach(() => {
  for (const key of MANAGED) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetServerEnvCache();
});

describe("getPublicEnv", () => {
  it("reads the legacy NEXT_PUBLIC_SUPABASE_ANON_KEY", () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-legacy" });

    expect(getPublicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("anon-legacy");
  });

  it("falls back to the new publishable key name", () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_new",
    });

    expect(getPublicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("sb_publishable_new");
  });

  it("prefers the legacy name when both are present", () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-legacy",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_new",
    });

    expect(getPublicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("anon-legacy");
  });

  it("rejects a project URL pasted as the key", () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_URL,
    });

    expect(isPublicEnvConfigured()).toBe(false);
    expect(() => getPublicEnv()).toThrow(/looks like a URL/);
  });

  it("reports unconfigured when nothing is set", () => {
    setEnv({});

    expect(isPublicEnvConfigured()).toBe(false);
  });
});

describe("getServerEnv", () => {
  it("accepts a complete environment", () => {
    setEnv(validServerEnv);

    expect(getServerEnv().SUPABASE_SERVICE_ROLE_KEY).toBe("sb_secret_server_side");
  });

  it("accepts SUPABASE_SECRET_KEY as the service key", () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _ignored, ...rest } = validServerEnv;
    setEnv({ ...rest, SUPABASE_SECRET_KEY: "sb_secret_alias" });

    expect(getServerEnv().SUPABASE_SERVICE_ROLE_KEY).toBe("sb_secret_alias");
  });

  it("rejects a project URL pasted as the service key", () => {
    setEnv({ ...validServerEnv, SUPABASE_SERVICE_ROLE_KEY: SUPABASE_URL });

    expect(() => getServerEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY looks like a URL/);
  });

  it("still accepts the historical FIRECLAW_API_KEY typo", () => {
    const { FIRECRAWL_API_KEY: _ignored, ...rest } = validServerEnv;
    setEnv({ ...rest, FIRECLAW_API_KEY: "fc-typo" });

    expect(getServerEnv().FIRECRAWL_API_KEY).toBe("fc-typo");
  });

  it("requires a CRON_SECRET of at least 16 chars", () => {
    setEnv({ ...validServerEnv, CRON_SECRET: "short" });

    expect(() => getServerEnv()).toThrow(/CRON_SECRET/);
  });
});
