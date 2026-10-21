import { formatDateTime } from "./templates";
import type { RenderedEmail } from "./templates";

/** Internal team notifications. Never sent to customers. */

export type OnboardingNotificationInput = {
  requestId: string;
  email: string;
  companyName: string;
  competitorUrls: readonly string[];
  goals: string;
  createdAt: Date;
  timeZone: string;
  adminUrl?: string;
};

export function renderOnboardingNotification(
  input: OnboardingNotificationInput,
): RenderedEmail {
  const body = [
    "NUEVA SOLICITUD DE ONBOARDING",
    "",
    `Empresa: ${input.companyName}`,
    `Email: ${input.email}`,
    `Recibida: ${formatDateTime(input.createdAt, input.timeZone)} (${input.timeZone})`,
    `Solicitud: ${input.requestId}`,
    "",
    "OBJETIVOS DE RASTREO",
    input.goals.trim() || "(sin objetivos declarados)",
    "",
    "COMPETIDORES SOLICITADOS",
    ...input.competitorUrls.map((url, index) => `${index + 1}. ${url}`),
    "",
    "--",
    "Próximo paso: crear el cliente en public.clients (ligado al usuario de Supabase Auth),",
    "cargar los competidores y activar la cuenta. El setup es semi-manual en el MVP.",
    ...(input.adminUrl ? [`Panel: ${input.adminUrl}`] : []),
  ].join("\n");

  return {
    subject: `[Onboarding] ${input.companyName} — ${input.competitorUrls.length} competidores`,
    body,
  };
}

export type ExtractionFailureInput = {
  competitorName: string;
  competitorUrl: string;
  errorMessage: string;
  httpStatus: number | null;
  occurredAt: Date;
  timeZone: string;
};

/** AC-003: log the failure and alert the admin, never the customer. */
export function renderExtractionFailure(
  input: ExtractionFailureInput,
): RenderedEmail {
  const body = [
    "FALLO DE EXTRACCIÓN — ACCIÓN REQUERIDA",
    "",
    `Competidor: ${input.competitorName}`,
    `URL: ${input.competitorUrl}`,
    `HTTP: ${input.httpStatus ?? "sin respuesta"}`,
    `Error: ${input.errorMessage}`,
    `Ocurrió: ${formatDateTime(input.occurredAt, input.timeZone)} (${input.timeZone})`,
    "",
    "--",
    "Registrado en public.extractions (status=failed) y public.system_events.",
    "El cliente NO fue notificado (política del MVP, sin fallback automático).",
    "Revisá la URL manualmente: puede ser anti-bot, timeout o un cambio de estructura.",
  ].join("\n");

  return {
    subject: `[Extracción] Falló ${input.competitorName}`,
    body,
  };
}
