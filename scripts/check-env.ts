import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Configuration doctor: `npm run check:env`
 *
 * Tells you exactly which credentials are still missing and, for the ones that
 * are already present, verifies them against the live service. It never spends
 * LLM tokens and never calls Firecrawl's billable scrape endpoint unless you
 * pass `--deep`.
 */

type Status = "ok" | "warn" | "fail" | "skip";

type Line = { label: string; status: Status; detail: string };

const lines: Line[] = [];
const deep = process.argv.includes("--deep");

function record(label: string, status: Status, detail: string): void {
  lines.push({ label, status, detail });
}

/** Minimal .env loader so the doctor works before any tooling is configured. */
function loadEnvFile(): string | null {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return null;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Real environment variables (Vercel, shell) win over the file.
    if (!process.env[key]) process.env[key] = value;
  }

  return path;
}

function mask(value: string | undefined): string {
  if (!value) return "sin valor";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

async function checkSupabaseTable(
  url: string,
  serviceKey: string,
  table: string,
): Promise<Line> {
  try {
    const response = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, {
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (response.ok) {
      return { label: `tabla ${table}`, status: "ok", detail: "existe y responde" };
    }

    const body = await response.text();

    if (response.status === 401 || response.status === 403) {
      return {
        label: `tabla ${table}`,
        status: "fail",
        detail: `clave rechazada (HTTP ${response.status}). ¿Es la service_role key?`,
      };
    }

    if (/PGRST205|does not exist|no existe/i.test(body)) {
      return {
        label: `tabla ${table}`,
        status: "fail",
        detail: "no existe: falta aplicar las migraciones de supabase/migrations",
      };
    }

    return {
      label: `tabla ${table}`,
      status: "warn",
      detail: `HTTP ${response.status}: ${body.slice(0, 120)}`,
    };
  } catch (error) {
    return { label: `tabla ${table}`, status: "fail", detail: (error as Error).message };
  }
}

async function checkLlm(baseUrl: string, apiKey: string, model: string): Promise<Line[]> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return [
        {
          label: "LLM /models",
          status: response.status === 401 ? "fail" : "warn",
          detail: `HTTP ${response.status}. La clave se probará en la primera corrida.`,
        },
      ];
    }

    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    const ids = (payload.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id));

    return [
      { label: "LLM /models", status: "ok", detail: `${ids.length} modelos disponibles` },
      {
        label: `modelo ${model}`,
        status: ids.length === 0 || ids.includes(model) ? "ok" : "warn",
        detail:
          ids.length === 0 || ids.includes(model)
            ? "configurado"
            : "no aparece en el listado (¿usás un alias propio?)",
      },
    ];
  } catch (error) {
    return [{ label: "LLM /models", status: "warn", detail: (error as Error).message }];
  }
}

async function checkResend(apiKey: string, from: string): Promise<Line[]> {
  try {
    const response = await fetch("https://api.resend.com/domains", {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return [
        {
          label: "Resend /domains",
          status: response.status === 401 ? "fail" : "warn",
          detail: `HTTP ${response.status}`,
        },
      ];
    }

    const payload = (await response.json()) as {
      data?: Array<{ name?: string; status?: string }>;
    };
    const verified = (payload.data ?? [])
      .filter((domain) => domain.status === "verified")
      .map((domain) => domain.name)
      .filter((name): name is string => Boolean(name));

    if (verified.length === 0) {
      return [
        {
          label: "dominio verificado",
          status: "fail",
          detail: "ningún dominio verificado en Resend: los envíos fallan con 403",
        },
      ];
    }

    const fromDomain = from.match(/@([^>\s]+)/)?.[1] ?? "";
    const matches = verified.some(
      (domain) => fromDomain === domain || fromDomain.endsWith(`.${domain}`),
    );

    return [
      { label: "dominio verificado", status: "ok", detail: verified.join(", ") },
      {
        label: "EMAIL_FROM",
        status: matches ? "ok" : "fail",
        detail: matches
          ? fromDomain
          : `${fromDomain || "?"} no está verificado (verificados: ${verified.join(", ")})`,
      },
    ];
  } catch (error) {
    return [{ label: "Resend /domains", status: "warn", detail: (error as Error).message }];
  }
}

async function checkFirecrawl(apiKey: string): Promise<Line> {
  if (!deep) {
    return {
      label: "Firecrawl scrape",
      status: "skip",
      detail: "no se ejecuta por defecto (gasta 1 crédito): usá --deep o npm run smoke:firecrawl",
    };
  }

  try {
    const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url: "https://example.com", formats: ["markdown"] }),
      signal: AbortSignal.timeout(60_000),
    });

    const body = (await response.json().catch(() => null)) as
      | { success?: boolean; data?: { markdown?: string }; error?: string }
      | null;

    if (response.ok && body?.success !== false && body?.data?.markdown) {
      return {
        label: "Firecrawl scrape",
        status: "ok",
        detail: `${body.data.markdown.length} chars de markdown`,
      };
    }

    return {
      label: "Firecrawl scrape",
      status: "fail",
      detail: body?.error ?? `HTTP ${response.status}`,
    };
  } catch (error) {
    return { label: "Firecrawl scrape", status: "fail", detail: (error as Error).message };
  }
}

const ICON: Record<Status, string> = { ok: "OK   ", warn: "AVISO", fail: "FALTA", skip: "SALTO" };

/**
 * Values copied from .env.example that pass schema validation but are not real
 * credentials. Without this the doctor would report "todo listo" on a fresh clone.
 */
const PLACEHOLDER = /your-project|your-domain|yourcompany|example\.com|changeme|cambiar/i;

const REQUIRED_VARS: Array<{ key: string; hint: string }> = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", hint: "Supabase → Project Settings → Data API → Project URL" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", hint: "Supabase → Settings → API Keys → anon public" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", hint: "Supabase → Settings → API Keys → service_role (secreta)" },
  { key: "FIRECRAWL_API_KEY", hint: "firecrawl.dev → API Keys" },
  { key: "LLM_API_KEY", hint: "API key de tu proveedor LLM" },
  { key: "RESEND_API_KEY", hint: "resend.com → API Keys" },
  { key: "EMAIL_FROM", hint: "remitente de un dominio verificado en Resend" },
  { key: "ADMIN_EMAIL", hint: "casilla interna del equipo" },
  { key: "CRON_SECRET", hint: "32+ caracteres aleatorios: openssl rand -hex 32" },
];

function readVar(key: string): string {
  // FIRECLAW_API_KEY is the historical typo still accepted by src/lib/env.ts.
  const raw =
    key === "FIRECRAWL_API_KEY"
      ? (process.env.FIRECRAWL_API_KEY ?? process.env.FIRECLAW_API_KEY ?? "")
      : (process.env[key] ?? "");

  return raw.trim();
}

async function main(): Promise<void> {
  const envFile = loadEnvFile();
  console.log(
    envFile
      ? `Leyendo ${envFile} (el entorno real tiene prioridad)\n`
      : "Sin archivo .env: solo entorno real\n",
  );

  const values = new Map<string, string>();

  for (const { key, hint } of REQUIRED_VARS) {
    const value = readVar(key);
    values.set(key, value);

    if (!value) {
      record(key, "fail", `vacía. ${hint}`);
      continue;
    }

    if (PLACEHOLDER.test(value)) {
      record(key, "fail", `sigue el placeholder de .env.example. ${hint}`);
      continue;
    }

    if (key === "CRON_SECRET" && value.length < 16) {
      record(key, "fail", `muy corto (${value.length} chars, mínimo 16)`);
      continue;
    }

    record(key, "ok", mask(value));
  }

  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_APP_URL"] as const) {
    const value = values.get(key) ?? readVar(key);
    if (!value || PLACEHOLDER.test(value)) continue;

    try {
      new URL(value);
      if (!values.has(key)) record(key, "ok", mask(value));
    } catch {
      record(key, "fail", `no es una URL válida: ${value.slice(0, 40)}`);
    }
  }

  const supabaseUrl = values.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
  const serviceKey = values.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const llmKey = values.get("LLM_API_KEY") ?? "";
  const resendKey = values.get("RESEND_API_KEY") ?? "";
  const firecrawlKey = values.get("FIRECRAWL_API_KEY") ?? "";

  if (supabaseUrl && serviceKey && !PLACEHOLDER.test(supabaseUrl)) {
    const tables = await Promise.all(
      ["clients", "onboarding_requests", "digests"].map((table) =>
        checkSupabaseTable(supabaseUrl, serviceKey, table),
      ),
    );
    lines.push(...tables);
  }

  if (llmKey && !PLACEHOLDER.test(llmKey)) {
    lines.push(
      ...(await checkLlm(
        readVar("LLM_BASE_URL") || "https://api.openai.com/v1",
        llmKey,
        readVar("LLM_MODEL") || "gpt-4o-mini",
      )),
    );
  }

  if (resendKey && !PLACEHOLDER.test(resendKey)) {
    lines.push(...(await checkResend(resendKey, values.get("EMAIL_FROM") ?? "")));
  }

  if (firecrawlKey && !PLACEHOLDER.test(firecrawlKey)) {
    lines.push(await checkFirecrawl(firecrawlKey));
  }

  console.log("");
  for (const line of lines) {
    console.log(`[${ICON[line.status]}] ${line.label.padEnd(28)} ${line.detail}`);
  }

  const blockers = lines.filter((line) => line.status === "fail");
  const warnings = lines.filter((line) => line.status === "warn");

  console.log(
    `\n${blockers.length === 0 ? "Sin bloqueos" : `${blockers.length} bloqueo(s)`}, ${warnings.length} aviso(s).`,
  );

  if (blockers.length > 0) {
    console.log("\nQué hacer:");
    console.log("  1. Supabase: crear proyecto + aplicar supabase/migrations en orden");
    console.log("  2. Completar las variables marcadas [FALTA] en .env (ver .env.example)");
    console.log("  3. Volver a correr: npm run check:env");
    console.log("  4. Con todo verde: npm run cron:extract -- --force");
    process.exitCode = 1;
    return;
  }

  console.log("\nConfiguración completa. Siguiente paso:");
  console.log("  npm run cron:extract -- --force   # primer relevamiento (guarda la línea base)");
}

main().catch((error) => {
  console.error("[check-env] falló:", error);
  process.exitCode = 1;
});
