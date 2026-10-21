import type { Finding } from "../types";

/**
 * All customer-facing output is plain text (spec: "Email en texto plano",
 * consultative tone, one page). No HTML, no images, no tracking pixels.
 */

const MAX_BULLETS_PER_SECTION = 5;
const MAX_BODY_CHARS = 4_000;

export type RenderedEmail = {
  subject: string;
  body: string;
};

export function formatDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function priorityWeight(priority: Finding["priority"]): number {
  switch (priority) {
    case "ALTA_PRIORIDAD":
      return 3;
    case "MEDIA":
      return 2;
    default:
      return 1;
  }
}

function orderFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const byPriority = priorityWeight(b.priority) - priorityWeight(a.priority);
    if (byPriority !== 0) return byPriority;
    return a.competitorName.localeCompare(b.competitorName, "es");
  });
}

function section(title: string, lines: readonly string[]): string {
  const content =
    lines.length > 0
      ? lines.slice(0, MAX_BULLETS_PER_SECTION).join("\n")
      : "Sin cambios relevantes.";
  return `${title}\n${content}`;
}

function clip(body: string): string {
  if (body.length <= MAX_BODY_CHARS) return body;
  return `${body.slice(0, MAX_BODY_CHARS - 40).trimEnd()}\n\n[...]`;
}

export type DigestInput = {
  companyName: string;
  weekLabel: string;
  timeZone: string;
  findings: readonly Finding[];
  generatedAt: Date;
  dashboardUrl?: string;
};

/**
 * AC-001: one-page weekly email with bullets grouped by
 * Precios, Posicionamiento y Productos.
 */
export function renderWeeklyDigest(input: DigestInput): RenderedEmail {
  const findings = orderFindings(input.findings).filter(
    (finding) => finding.hasMeaningfulChange,
  );

  const competitors = new Set(findings.map((finding) => finding.competitorId));
  const subject = `Resumen competitivo de ${input.companyName} — semana del ${input.weekLabel}`;

  const priceLines: string[] = [];
  const positioningLines: string[] = [];
  const productLines: string[] = [];

  for (const finding of findings) {
    for (const bullet of finding.precios) {
      priceLines.push(`- ${finding.competitorName}: ${bullet}`);
    }
    for (const bullet of finding.posicionamiento) {
      positioningLines.push(`- ${finding.competitorName}: ${bullet}`);
    }
    for (const bullet of finding.productos) {
      productLines.push(`- ${finding.competitorName}: ${bullet}`);
    }
  }

  const intro =
    findings.length === 0
      ? "Esta semana no detectamos cambios accionables en tus competidores."
      : `Esto es lo que cambió esta semana en ${competitors.size} ${
          competitors.size === 1 ? "competidor" : "competidores"
        }.`;

  const footerLines = [
    `${findings.length} ${
      findings.length === 1 ? "hallazgo validado" : "hallazgos validados"
    } en la semana del ${input.weekLabel}.`,
    `Generado el ${formatDateTime(input.generatedAt, input.timeZone)} (${input.timeZone}).`,
  ];

  if (input.dashboardUrl) footerLines.push(`Historial: ${input.dashboardUrl}`);
  footerLines.push("Respondé este correo si querés ajustar el foco del rastreo.");

  const body = clip(
    [
      "RESUMEN EJECUTIVO SEMANAL",
      input.companyName,
      `Semana: ${input.weekLabel}`,
      "",
      intro,
      "",
      section("PRECIOS", priceLines),
      "",
      section("POSICIONAMIENTO", positioningLines),
      "",
      section("PRODUCTOS", productLines),
      "",
      "--",
      ...footerLines,
    ].join("\n"),
  );

  return { subject, body };
}

export type AlertInput = {
  companyName: string;
  competitorName: string;
  competitorUrl: string;
  headline: string;
  priority: Finding["priority"];
  precios: readonly string[];
  posicionamiento: readonly string[];
  productos: readonly string[];
  reasoning?: string;
  detectedAt: Date;
  timeZone: string;
};

/** FR-004: immediate plain-text alert, no waiting for the weekly digest. */
export function renderHighPriorityAlert(input: AlertInput): RenderedEmail {
  const changed: string[] = [];

  for (const bullet of input.precios.slice(0, MAX_BULLETS_PER_SECTION)) {
    changed.push(`- Precio: ${bullet}`);
  }
  for (const bullet of input.posicionamiento.slice(0, MAX_BULLETS_PER_SECTION)) {
    changed.push(`- Posicionamiento: ${bullet}`);
  }
  for (const bullet of input.productos.slice(0, MAX_BULLETS_PER_SECTION)) {
    changed.push(`- Producto: ${bullet}`);
  }

  const body = clip(
    [
      "ALERTA DE ALTA PRIORIDAD",
      "",
      `${input.competitorName}: ${input.headline}`,
      "",
      `Detectado: ${formatDateTime(input.detectedAt, input.timeZone)} (${input.timeZone})`,
      `Fuente: ${input.competitorUrl}`,
      "",
      "QUÉ CAMBIÓ",
      changed.length > 0 ? changed.join("\n") : "- Cambio drástico detectado en el sitio.",
      "",
      ...(input.reasoning ? ["POR QUÉ IMPORTA", input.reasoning, ""] : []),
      "--",
      "Te enviamos este aviso antes del resumen semanal porque el cambio se clasificó como drástico.",
      `Cuenta: ${input.companyName}. Respondé este correo si necesitás el detalle completo.`,
    ].join("\n"),
  );

  return {
    subject: `[ALERTA] ${input.competitorName}: ${input.headline}`.slice(0, 150),
    body,
  };
}
