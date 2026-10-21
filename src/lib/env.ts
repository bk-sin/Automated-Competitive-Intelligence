import { z } from "zod";

/**
 * Server-side environment. Validated lazily (on first use) so that pure
 * modules and the build step do not require secrets to be present.
 *
 * NOTE: the historical variable name `FIRECLAW_API_KEY` (typo) is still
 * accepted as a fallback so existing deployments keep working.
 */
const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  FIRECRAWL_API_KEY: z.string().min(1, "FIRECRAWL_API_KEY is required"),
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY is required"),
  LLM_BASE_URL: z.url().default("https://api.openai.com/v1"),
  LLM_MODEL: z.string().min(1).default("gpt-4o-mini"),
  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
  EMAIL_FROM: z.string().min(3, "EMAIL_FROM is required"),
  ADMIN_EMAIL: z.email(),
  CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 chars"),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

function readRawEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    FIRECRAWL_API_KEY:
      process.env.FIRECRAWL_API_KEY ?? process.env.FIRECLAW_API_KEY ?? undefined,
  };
}

export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(readRawEnv());
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server environment -> ${details}`);
  }

  cached = parsed.data;
  return cached;
}

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cachedPublic: PublicEnv | null = null;

/**
 * Only the variables that are safe in the browser bundle. Used by the
 * dashboard/middleware so the portal can boot without service-role secrets.
 */
export function getPublicEnv(): PublicEnv {
  if (cachedPublic) return cachedPublic;

  const parsed = publicEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid public environment -> ${details}`);
  }

  cachedPublic = parsed.data;
  return cachedPublic;
}

/** Test helper: forget the memoized env (never used at runtime). */
export function resetServerEnvCache(): void {
  cached = null;
  cachedPublic = null;
}

/**
 * Cheap, non-throwing check used by pages so a deployment without Supabase
 * credentials shows a setup notice instead of crashing with HTTP 500.
 */
export function isPublicEnvConfigured(): boolean {
  return publicEnvSchema.safeParse(process.env).success;
}
