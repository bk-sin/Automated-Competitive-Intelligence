import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { type ContentDiff, buildDiffContext, diffContent } from "../src/lib/diff";
import { sendPlainTextEmail } from "../src/lib/email/resend";
import { renderProspectingAudit } from "../src/lib/email/templates";
import { getServerEnv } from "../src/lib/env";
import { scrapeUrl } from "../src/lib/firecrawl";
import { analyzeDiff } from "../src/lib/llm";
import type { AnalysisResult, Finding } from "../src/lib/types";
import { findSnapshot } from "../src/lib/wayback";

/**
 * Auditor de prospeccion: el "sobre rojo" del playbook (docs/prospection-spec.md)
 * generado con datos reales.
 *
 *   npm run prospect:audit -- --file=prospects/ejemplo.json
 *   PROSPECT_SEND=1 npm run prospect:audit -- --file=... --to=yo@dominio.com
 *
 * Por que no usa `demo:preview`: ese simula el pasado corriendo los precios -10%,
 * que sirve para mostrar el producto a un cliente que ya confia. Un prospecto
 * frio puede abrir la web y ver que el precio nunca fue $20.700: se quema el
 * email y la venta. Aca el pasado sale del archivo publico (Wayback), asi que
 * cada afirmacion del correo se puede verificar.
 *
 * Cuando un competidor no esta archivado, se lo reporta como "no comparable".
 * Nunca se lo cuenta como "sin cambios": son cosas distintas.
 */

type CompetitorConfig = {
  name: string;
  pricingUrl?: string;
  changelogUrl?: string;
  careersUrl?: string;
};

type ProspectFile = {
  prospect: string;
  contactName?: string;
  senderName?: string;
  replyTo?: string;
  goals?: string;
  days?: number;
  competitors: CompetitorConfig[];
};

type PageTarget = { label: string; url: string };

type PageAudit = {
  label: string;
  url: string;
  status: "changed" | "silent" | "unavailable" | "error";
  detail: string;
  snapshotUrl?: string;
  snapshotDate?: Date;
  diff?: ContentDiff;
  analysis?: AnalysisResult;
};

type CompetitorAudit = {
  name: string;
  pages: PageAudit[];
};

const DEFAULT_DAYS = 30;
const SCRAPE_TIMEOUT_MS = 60_000;
const MAX_PAGES_PER_COMPETITOR = 3;

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  if (match) return match.slice(prefix.length).trim();

  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1]?.trim() : undefined;
}

function readRequest(): { file: string; send: boolean; to?: string; days?: number } {
  const positional = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  const file = readFlag("file") ?? process.env.PROSPECT_FILE ?? positional ?? "";
  const days = Number(readFlag("days") ?? process.env.PROSPECT_DAYS ?? "");

  return {
    file,
    send: process.env.PROSPECT_SEND === "1" || process.argv.includes("--send"),
    to: (readFlag("to") ?? process.env.PROSPECT_TO)?.trim(),
    days: Number.isFinite(days) && days > 0 ? days : undefined,
  };
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/** Un competidor puede traer hasta 3 paginas; sin precios no hay sobre rojo. */
function pagesOf(competitor: CompetitorConfig): PageTarget[] {
  const pages: PageTarget[] = [];
  if (competitor.pricingUrl) pages.push({ label: "precios", url: competitor.pricingUrl });
  if (competitor.changelogUrl) pages.push({ label: "novedades", url: competitor.changelogUrl });
  if (competitor.careersUrl) pages.push({ label: "empleos", url: competitor.careersUrl });
  return pages.slice(0, MAX_PAGES_PER_COMPETITOR);
}

function loadProspect(raw: string): ProspectFile {
  const data = JSON.parse(raw) as Partial<ProspectFile>;
  const prospect = (data.prospect ?? "").trim();

  if (!prospect) throw new Error("El archivo no define `prospect` (nombre del prospecto).");
  if (!Array.isArray(data.competitors) || data.competitors.length === 0) {
    throw new Error("El archivo no define `competitors` (al menos uno con una URL).");
  }

  const competitors = data.competitors.map((competitor, index) => {
    const name = (competitor?.name ?? "").trim();
    if (!name) throw new Error(`El competidor #${index + 1} no tiene nombre.`);
    if (pagesOf(competitor).length === 0) {
      throw new Error(
        `"${name}" no tiene ninguna URL: usá pricingUrl, changelogUrl o careersUrl.`,
      );
    }
    return { ...competitor, name };
  });

  const days = Number(data.days);

  return {
    ...data,
    prospect,
    competitors,
    days: Number.isFinite(days) && days > 0 ? days : undefined,
  } as ProspectFile;
}

type AuditEnv = {
  firecrawlKey: string;
  llm: { apiKey: string; baseUrl: string; model: string };
  days: number;
  goals: string;
};

/**
 * Un snapshot archivado puede ser un soft-404 (la pagina ya no existe y el
 * archivo devuelve su propio cartel). Comparar eso contra la web de hoy
 * produce cientos de lineas de ruido, asi que se descarta por similitud.
 */
const MIN_SIMILARITY = 0.3;
const MIN_LIVE_CHARS = 200;

async function auditPage(
  competitor: CompetitorConfig,
  page: PageTarget,
  context: AuditEnv,
): Promise<PageAudit> {
  const base = { label: page.label, url: page.url };

  let snapshot;
  try {
    snapshot = await findSnapshot(page.url, {
      daysAgo: context.days,
      windowDays: Math.max(7, Math.ceil(context.days / 3)),
    });
  } catch (error) {
    return { ...base, status: "error", detail: `Wayback: ${(error as Error).message}` };
  }

  if (!snapshot) {
    return {
      ...base,
      status: "unavailable",
      detail: `Sin snapshot público en la ventana de ${context.days} días`,
    };
  }

  const archival = { snapshotUrl: snapshot.url, snapshotDate: snapshot.archivedAt };

  try {
    const [before, after] = await Promise.all([
      scrapeUrl(snapshot.url, { apiKey: context.firecrawlKey, timeoutMs: SCRAPE_TIMEOUT_MS }),
      scrapeUrl(page.url, { apiKey: context.firecrawlKey, timeoutMs: SCRAPE_TIMEOUT_MS }),
    ]);

    if (after.markdown.trim().length < MIN_LIVE_CHARS) {
      return { ...base, ...archival, status: "error", detail: "La página viva vino casi vacía" };
    }

    const diff = diffContent(before.markdown, after.markdown);

    if (diff.similarity < MIN_SIMILARITY) {
      return {
        ...base,
        ...archival,
        diff,
        status: "unavailable",
        detail: `Snapshot poco comparable (similitud ${diff.similarity.toFixed(2)})`,
      };
    }

    if (!diff.changed) {
      return { ...base, ...archival, diff, status: "silent", detail: "Sin diferencias de texto" };
    }

    const diffContext = buildDiffContext(diff);
    if (diffContext.totalChanges === 0) {
      return {
        ...base,
        ...archival,
        diff,
        status: "silent",
        detail: "Solo ruido de navegación / formato",
      };
    }

    const response = await analyzeDiff(
      {
        competitorName: competitor.name,
        competitorUrl: page.url,
        clientGoals: context.goals,
        diffText: diffContext.text,
        priceChanges: diffContext.priceChanges,
        totalChanges: diffContext.totalChanges,
        truncated: diffContext.truncated,
      },
      context.llm,
    );

    if (!response.analysis.hasMeaningfulChange) {
      return {
        ...base,
        ...archival,
        diff,
        analysis: response.analysis,
        status: "silent",
        detail: `${diffContext.totalChanges} líneas, ninguna accionable`,
      };
    }

    return {
      ...base,
      ...archival,
      diff,
      analysis: response.analysis,
      status: "changed",
      detail: `${response.analysis.priority} · ${diffContext.totalChanges} líneas (${diffContext.priceChanges} de precio)`,
    };
  } catch (error) {
    return {
      ...base,
      ...archival,
      status: "error",
      detail: (error as Error).message.slice(0, 200),
    };
  }
}

async function auditCompetitor(
  competitor: CompetitorConfig,
  context: AuditEnv,
): Promise<CompetitorAudit> {
  const pages: PageAudit[] = [];

  for (const page of pagesOf(competitor)) {
    const audit = await auditPage(competitor, page, context);
    pages.push(audit);
    console.log(`  ${page.label.padEnd(10)} ${audit.status.padEnd(12)} ${audit.detail}`);
  }

  return { name: competitor.name, pages };
}

/**
 * Un bloque por competidor: se queda con la página de mayor señal
 * (precios > novedades > empleos) para que el correo no repita el mismo hecho.
 */
function findingOf(competitor: CompetitorAudit): Finding | null {
  const chosen = competitor.pages.find((page) => page.status === "changed");
  if (!chosen?.analysis) return null;

  return {
    competitorId: slugify(competitor.name),
    competitorName: competitor.name,
    competitorUrl: chosen.url,
    detectedAt: chosen.snapshotDate ?? new Date(),
    ...chosen.analysis,
  };
}

function renderDraft(
  prospect: ProspectFile,
  audits: readonly CompetitorAudit[],
  email: { subject: string; body: string },
  generatedAt: Date,
): string {
  const lines: string[] = [
    `# Sobre rojo — ${prospect.prospect}`,
    "",
    `Generado: ${generatedAt.toISOString()}`,
    `Ventana comparada: ${prospect.days} días contra el archivo público`,
    "",
    `Asunto: ${email.subject}`,
    "",
    "## Cuerpo del correo",
    "",
    email.body,
    "",
    "## Auditoría (verificable, no enviada)",
    "",
    "| Competidor | Página | Estado | Detalle | Snapshot |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const audit of audits) {
    for (const page of audit.pages) {
      lines.push(
        `| ${audit.name} | ${page.label} | ${page.status} | ${page.detail.replace(/\|/g, "\\|")} | ${
          page.snapshotDate ? formatDay(page.snapshotDate) : "—"
        } |`,
      );
    }
  }

  for (const audit of audits) {
    for (const page of audit.pages) {
      if (!page.diff) continue;
      const context = buildDiffContext(page.diff, { maxLines: 40, maxChars: 3000 });
      if (context.totalChanges === 0) continue;

      lines.push("", `### ${audit.name} — ${page.label}`, "", `Hoy: ${page.url}`);
      if (page.snapshotUrl) lines.push(`Archivo: ${page.snapshotUrl}`);
      lines.push("", "```diff", context.text, "```");
    }
  }

  return lines.join("\n");
}

function classify(audits: readonly CompetitorAudit[]): {
  findings: Finding[];
  silentCompetitors: string[];
  unavailableCompetitors: string[];
} {
  const findings = audits.map(findingOf).filter((finding): finding is Finding => finding !== null);
  const changed = new Set(findings.map((finding) => finding.competitorName));

  const rest = audits.filter((audit) => !changed.has(audit.name));

  return {
    findings,
    // Comparado y sin cambios: se puede afirmar.
    silentCompetitors: rest
      .filter((audit) => audit.pages.some((page) => page.status === "silent"))
      .map((audit) => audit.name),
    // Sin archivo o sin página comparable: no se puede afirmar nada.
    unavailableCompetitors: rest
      .filter((audit) => !audit.pages.some((page) => page.status === "silent"))
      .map((audit) => audit.name),
  };
}

async function main(): Promise<void> {
  const request = readRequest();

  if (!request.file) {
    console.error(
      "Falta el archivo del prospecto: npm run prospect:audit -- prospects/acme.json " +
        "(o --file=..., o PROSPECT_FILE).",
    );
    process.exitCode = 1;
    return;
  }

  const path = resolve(request.file);

  let prospect: ProspectFile & { days: number };
  try {
    const parsed = loadProspect(await readFile(path, "utf8"));
    prospect = { ...parsed, days: request.days ?? parsed.days ?? DEFAULT_DAYS };
  } catch (error) {
    console.error(`No pude leer ${path}: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const env = getServerEnv();
  const context: AuditEnv = {
    firecrawlKey: env.FIRECRAWL_API_KEY,
    llm: { apiKey: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL },
    days: prospect.days,
    goals: prospect.goals ?? "",
  };

  console.log(`Prospecto:  ${prospect.prospect}`);
  console.log(`Ventana:    ${prospect.days} días (archivo público vs. web de hoy)`);
  console.log(`Objetivos:  ${context.goals || "(generales)"}`);
  console.log(`Competidores: ${prospect.competitors.length}\n`);

  const audits: CompetitorAudit[] = [];
  for (const competitor of prospect.competitors) {
    console.log(`${competitor.name}`);
    audits.push(await auditCompetitor(competitor, context));
  }

  const { findings, silentCompetitors, unavailableCompetitors } = classify(audits);

  const snapshotDates = audits
    .flatMap((audit) => audit.pages.map((page) => page.snapshotDate))
    .filter((date): date is Date => date instanceof Date);

  const generatedAt = new Date();
  const baseline =
    snapshotDates.length > 0
      ? new Date(Math.min(...snapshotDates.map((date) => date.getTime())))
      : new Date(generatedAt.getTime() - prospect.days * 86_400_000);

  const email = renderProspectingAudit({
    prospectName: prospect.prospect,
    contactName: prospect.contactName,
    days: prospect.days,
    baselineLabel: formatDay(baseline),
    findings,
    silentCompetitors,
    unavailableCompetitors,
    senderName: prospect.senderName,
    generatedAt,
    timeZone: "America/Argentina/Buenos_Aires",
  });

  console.log(
    `\nResumen: ${findings.length} con cambios, ${silentCompetitors.length} sin cambios, ` +
      `${unavailableCompetitors.length} no comparables`,
  );

  for (const finding of findings) {
    console.log(`  · ${finding.competitorName} [${finding.priority}]: ${finding.headline}`);
  }

  console.log(`\n--- asunto ---\n${email.subject}\n--- cuerpo ---\n${email.body}`);

  const draftPath = resolve(
    "out",
    `prospecto-${slugify(prospect.prospect)}-${generatedAt.toISOString().slice(0, 10)}.md`,
  );
  await mkdir(dirname(draftPath), { recursive: true });
  await writeFile(draftPath, `${renderDraft(prospect, audits, email, generatedAt)}\n`, "utf8");
  console.log(`\nBorrador con fuentes y diffs: ${draftPath}`);

  if (!request.send) {
    console.log(
      "Nada se envió. Para mandarlo: PROSPECT_SEND=1 PROSPECT_TO=vos@dominio.com " +
        "npm run prospect:audit -- prospects/archivo.json",
    );
    return;
  }

  if (!request.to) {
    console.error("Falta el destinatario: --to=persona@empresa.com o PROSPECT_TO.");
    process.exitCode = 1;
    return;
  }

  if (/resend\.dev$/i.test(env.EMAIL_FROM)) {
    console.log(
      "Aviso: el remitente sigue en el sandbox de Resend (resend.dev). Solo entrega a la casilla dueña de la cuenta; un prospecto real no lo va a recibir.",
    );
  }

  const result = await sendPlainTextEmail(
    {
      to: request.to,
      subject: email.subject,
      body: email.body,
      replyTo: prospect.replyTo,
    },
    { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM },
  );

  if (!result.ok) {
    console.error(`\nFalló el envío: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nEnviado a ${request.to} (id ${result.id}). Verificar con: npm run check:delivery`);
}

main().catch((error: unknown) => {
  console.error(`[prospect:audit] falló: ${(error as Error).message}`);
  process.exitCode = 1;
});

