import { createClient } from "@supabase/supabase-js";

import { buildDiffContext, diffContent } from "../src/lib/diff";
import { sendPlainTextEmail } from "../src/lib/email/resend";
import { renderWeeklyDigest } from "../src/lib/email/templates";
import { getServerEnv } from "../src/lib/env";
import { analyzeDiff } from "../src/lib/llm";
import { getWeekBounds } from "../src/lib/time";
import type { Finding } from "../src/lib/types";

/**
 * Genera el ejemplo comercial de un cliente con datos reales:
 *
 *   npm run demo:preview -- --company="Salón Berlín"
 *   DEMO_SEND=1 npm run demo:preview -- --company="Salón Berlín" --to=yo@dominio.com
 *
 * Por que existe: un cliente recien dado de alta solo tiene linea base, asi que
 * el primer digest dice "sin cambios" y no hay nada que mostrarle al prospecto
 * hasta que un competidor cambie algo (puede tardar semanas).
 *
 * Como lo resuelve: toma el markdown REAL que guardo Firecrawl y, partiendo de
 * ese texto, construye una "foto previa" con los precios corridos -X% (por
 * defecto 10). El contenido entrante sigue siendo la pagina real de hoy, y el
 * analisis lo hace el mismo LLM con el mismo prompt. Solo se simula el pasado.
 *
 * No escribe en `extractions`, `analyses` ni `alerts`: el digest se imprime y,
 * si se pide, se envia a la casilla indicada.
 */

type Scenario = {
  companyName: string;
  competitorName?: string;
  percent: number;
  send: boolean;
  to?: string;
};

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  if (match) return match.slice(prefix.length).trim();

  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1]?.trim() : undefined;
}

function readScenario(): Scenario {
  const percent = Number(readFlag("pct") ?? process.env.DEMO_PCT ?? "10");

  return {
    companyName: (readFlag("company") ?? process.env.DEMO_COMPANY ?? "").trim(),
    competitorName: (readFlag("competitor") ?? process.env.DEMO_COMPETITOR)?.trim(),
    percent: Number.isFinite(percent) && percent > 0 ? percent : 10,
    send: process.env.DEMO_SEND === "1" || process.argv.includes("--send"),
    to: (readFlag("to") ?? process.env.DEMO_TO)?.trim(),
  };
}

/**
 * Corre los numeros que estan pegados a un `$` (prefijo o sufijo), que es como
 * publican precios los tres sitios de barberia: `$23000`, `Price:$75,000`,
 * `Precio:30.000 $`. Deja intactos años, duraciones y conteos.
 */
function shiftPrices(markdown: string, percent: number): { text: string; count: number } {
  const factor = 1 - percent / 100;
  let count = 0;

  const rewrite = (raw: string): string => {
    const separator = raw.includes(".") ? "." : raw.includes(",") ? "," : "";
    const value = Number(raw.replace(/[.,]/g, ""));
    if (!Number.isFinite(value) || value < 100) return raw;

    const shifted = Math.round((value * factor) / 100) * 100;
    count += 1;

    if (!separator) return String(shifted);
    return String(shifted).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  };

  const amount = String.raw`\d{1,3}(?:[.,]\d{3})+|\d{3,}`;
  // Una sola pasada con alternancia: si el símbolo viene antes Y después del
  // número (`$30.000 $`), cada match se reescribe una única vez.
  const pattern = new RegExp(String.raw`\$(\s?)(${amount})|(${amount})(\s?\$)`, "g");

  const text = markdown.replace(
    pattern,
    (match: string, before: string, prefixed?: string, suffixed?: string, tail?: string) => {
      if (prefixed) return `$${before}${rewrite(prefixed)}`;
      if (suffixed) return `${rewrite(suffixed)}${tail ?? ""}`;
      return match;
    },
  );

  return { text, count };
}


async function main(): Promise<void> {
  const scenario = readScenario();
  if (!scenario.companyName) {
    console.error('Falta la empresa: --company="Salón Berlín" o DEMO_COMPANY.');
    process.exitCode = 1;
    return;
  }

  const env = getServerEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: clientRow, error: clientError } = await db
    .from("clients")
    .select("id, company_name, email, timezone, tracking_goals")
    .ilike("company_name", `%${scenario.companyName}%`)
    .maybeSingle();

  if (clientError) throw new Error(`No se pudo leer el cliente: ${clientError.message}`);

  const client = clientRow as {
    id: string;
    company_name: string;
    email: string;
    timezone: string;
    tracking_goals: string;
  } | null;

  if (!client) {
    console.error(`No existe un cliente que coincida con "${scenario.companyName}".`);
    process.exitCode = 1;
    return;
  }

  const { data: competitorRows } = await db
    .from("competitors")
    .select("id, name, url")
    .eq("client_id", client.id)
    .eq("is_active", true)
    .order("name");

  const competitors = (competitorRows ?? []) as Array<{ id: string; name: string; url: string }>;
  const wanted = scenario.competitorName?.toLowerCase();
  const competitor = wanted
    ? competitors.find((row) => row.name.toLowerCase().includes(wanted))
    : competitors[0];

  if (!competitor) {
    console.error(`"${client.company_name}" no tiene competidores${wanted ? ` como "${wanted}"` : ""}.`);
    process.exitCode = 1;
    return;
  }

  const { data: extractionRow } = await db
    .from("extractions")
    .select("markdown, extracted_at")
    .eq("competitor_id", competitor.id)
    .eq("status", "success")
    .not("markdown", "is", null)
    .order("extracted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const snapshot = extractionRow as { markdown: string; extracted_at: string } | null;
  if (!snapshot?.markdown) {
    console.error(
      `No hay línea base de ${competitor.name}. Corré primero: npm run cron:extract:force`,
    );
    process.exitCode = 1;
    return;
  }

  const previous = shiftPrices(snapshot.markdown, scenario.percent);
  const diff = diffContent(previous.text, snapshot.markdown);
  const context = buildDiffContext(diff);

  console.log(`Empresa:      ${client.company_name}`);
  console.log(`Competidor:   ${competitor.name} <${competitor.url}>`);
  console.log(`Baseline:     ${snapshot.extracted_at} (${snapshot.markdown.length} chars, real)`);
  console.log(`Simulación:   foto previa con ${previous.count} precios -${scenario.percent}%`);
  console.log(`Diff:         ${context.totalChanges} líneas, ${context.priceChanges} con precios\n`);

  if (!diff.changed || context.totalChanges === 0) {
    console.error("El diff quedó vacío: revisá --pct o corré una extracción nueva.");
    process.exitCode = 1;
    return;
  }

  const analysis = await analyzeDiff(
    {
      competitorName: competitor.name,
      competitorUrl: competitor.url,
      clientGoals: client.tracking_goals,
      diffText: context.text,
      priceChanges: context.priceChanges,
      totalChanges: context.totalChanges,
      truncated: context.truncated,
    },
    { apiKey: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL },
  );

  const finding: Finding = {
    competitorId: competitor.id,
    competitorName: competitor.name,
    competitorUrl: competitor.url,
    detectedAt: new Date(),
    ...analysis.analysis,
  };

  const now = new Date();
  const bounds = getWeekBounds(now, client.timezone);
  const rendered = renderWeeklyDigest({
    companyName: client.company_name,
    weekLabel: bounds.label,
    timeZone: client.timezone,
    findings: [finding],
    generatedAt: now,
    dashboardUrl: `${env.EMAIL_LINK_BASE_URL ?? env.NEXT_PUBLIC_APP_URL}/dashboard`,
  });

  console.log("--- analisis del LLM ---");
  console.log(
    JSON.stringify(
      {
        priority: finding.priority,
        hasMeaningfulChange: finding.hasMeaningfulChange,
        headline: finding.headline,
        precios: finding.precios,
        posicionamiento: finding.posicionamiento,
        productos: finding.productos,
      },
      null,
      2,
    ),
  );

  console.log(`\n--- email (${rendered.subject}) ---\n${rendered.body}`);

  if (!scenario.send) {
    console.log("\nNada se envió ni se guardó. Para mandarlo: DEMO_SEND=1 npm run demo:preview ...");
    return;
  }

  const to = scenario.to ?? client.email;
  const send = await sendPlainTextEmail(
    { to, subject: rendered.subject, body: rendered.body },
    { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM },
  );

  if (!send.ok) {
    console.error(`\nFallo el envío: ${send.error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nEnviado a ${to} (id ${send.id}). Verificar con: npm run check:delivery`);
}

main().catch((error: unknown) => {
  console.error(`[demo:preview] falló: ${(error as Error).message}`);
  process.exitCode = 1;
});
