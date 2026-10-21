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

export type ProspectingAuditInput = {
  prospectName: string;
  contactName?: string;
  /** Ventana que se le declara al prospecto ("últimos N días"). */
  days: number;
  /** Fecha del baseline usado, ya formateada (ej. "15/09/2026"). */
  baselineLabel: string;
  findings: readonly Finding[];
  /** Competidores comparados que no mostraron cambios relevantes. */
  silentCompetitors: readonly string[];
  /** Competidores sin snapshot público: NO es lo mismo que "sin cambios". */
  unavailableCompetitors: readonly string[];
  senderName?: string;
  generatedAt: Date;
  timeZone: string;
};

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} y ${names[1]}`;
  return `${names[0]} y ${names.length - 1} más`;
}

/**
 * "Sobre rojo" de prospección: el mismo motor, apuntado a los competidores de
 * alguien que todavía no es cliente.
 *
 * Regla de honestidad: solo se afirma lo que el diff contra el snapshot
 * público muestra. Un competidor sin snapshot va en su propia línea
 * ("no pude comparar"), nunca en la de "sin cambios" — si el prospecto entra a
 * la web y ve un cambio, el email se quema y con él la venta.
 */
export function renderProspectingAudit(input: ProspectingAuditInput): RenderedEmail {
  const findings = orderFindings(input.findings).filter(
    (finding) => finding.hasMeaningfulChange,
  );

  const changedNames = findings.map((finding) => finding.competitorName);
  const subject =
    findings.length === 1
      ? `Lo que movió ${changedNames[0]} en los últimos ${input.days} días`
      : findings.length > 1
        ? `Lo que movieron ${joinNames(changedNames)} en los últimos ${input.days} días`
        : `${input.silentCompetitors.length + input.unavailableCompetitors.length} competidores de ${
            input.prospectName
          }: sin movimientos relevantes en ${input.days} días`;

  const blocks: string[] = [];

  for (const finding of findings) {
    const details = [
      ...finding.precios.map((bullet) => `- ${bullet}`),
      ...finding.posicionamiento.map((bullet) => `- ${bullet}`),
      ...finding.productos.map((bullet) => `- ${bullet}`),
    ].slice(0, 2);

    blocks.push(
      [`${finding.competitorName}: ${finding.headline}`, ...details].join("\n"),
    );
  }

  const closing: string[] = [];
  if (input.silentCompetitors.length > 0) {
    closing.push(`Sin cambios relevantes: ${input.silentCompetitors.join(", ")}.`);
  }
  if (input.unavailableCompetitors.length > 0) {
    closing.push(
      `No pude comparar (sin versión archivada pública): ${input.unavailableCompetitors.join(", ")}.`,
    );
  }

  const intro =
    findings.length > 0
      ? `Comparé la web pública de tus competidores contra cómo estaba el ${input.baselineLabel}. Esto es lo que cambió:`
      : `Comparé la web pública de tus competidores contra cómo estaba el ${input.baselineLabel} y no encontré movimientos relevantes:`;

  const body = clip(
    [
      `Hola ${input.contactName?.trim() || `equipo de ${input.prospectName}`},`,
      "",
      intro,
      "",
      ...(blocks.length > 0 ? [blocks.join("\n\n"), ""] : []),
      ...(closing.length > 0 ? [closing.join("\n"), ""] : []),
      "Es el mismo motor con el que armo el resumen semanal de competencia: precios, planes, posicionamiento y vacantes, sin que nadie del equipo tenga que entrar a mirar las webs.",
      "",
      "Si te sirve, respondé este correo y te paso el detalle línea por línea. También me interesa entender cómo lo resuelven hoy.",
      "",
      input.senderName?.trim() || "Saludos",
      `(comparación generada el ${formatDateTime(input.generatedAt, input.timeZone)})`,
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
