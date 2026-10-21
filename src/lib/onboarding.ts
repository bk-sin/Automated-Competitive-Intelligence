import { z } from "zod";
import { getServerEnv } from "./env";
import { getAdminSupabase } from "./supabase/admin";
import { renderOnboardingNotification } from "./email/admin-templates";
import { sendPlainTextEmail } from "./email/resend";

/**
 * FR-001: the public onboarding form writes the request to Supabase and
 * notifies the internal team so the concierge setup can start.
 */

export const MAX_COMPETITORS = 10;

const onboardingSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(2, "Ingresá el nombre de tu empresa")
    .max(200, "El nombre de la empresa es demasiado largo"),
  email: z.email("Por favor ingrese un email válido").max(320),
  competitorUrls: z
    .array(z.url("Por favor ingrese una URL válida"))
    .min(1, "Ingresá al menos un competidor")
    .max(MAX_COMPETITORS, `Podés ingresar hasta ${MAX_COMPETITORS} competidores`),
  goals: z.string().trim().max(1000, "Los objetivos son demasiado largos").default(""),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;

export type ParseResult =
  | { ok: true; value: OnboardingInput }
  | { ok: false; error: string };

/** Accepts "acme.com" and normalises it to https://acme.com. */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".") || url.hostname.endsWith(".")) return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** Splits a textarea (newlines or commas) into unique, valid URLs. */
export function parseCompetitorUrls(raw: string): string[] {
  const candidates = raw
    .split(/[\n,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const urls: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (normalized && !urls.includes(normalized)) urls.push(normalized);
  }

  return urls;
}

export function parseOnboardingFormData(formData: FormData): ParseResult {
  const rawUrls = String(formData.get("competitors") ?? "");
  const candidateCount = rawUrls.split(/[\n,;]+/).filter((value) => value.trim()).length;
  const competitorUrls = parseCompetitorUrls(rawUrls);

  if (candidateCount > 0 && competitorUrls.length !== candidateCount) {
    return { ok: false, error: "Por favor ingrese una URL válida para cada competidor" };
  }

  const parsed = onboardingSchema.safeParse({
    companyName: String(formData.get("companyName") ?? ""),
    email: String(formData.get("email") ?? ""),
    competitorUrls,
    goals: String(formData.get("goals") ?? ""),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Revisá los datos del formulario",
    };
  }

  return { ok: true, value: parsed.data };
}

export type CreatedRequest = {
  id: string;
  adminNotified: boolean;
};

export async function createOnboardingRequest(
  input: OnboardingInput,
  now: Date = new Date(),
): Promise<CreatedRequest> {
  const env = getServerEnv();
  const db = getAdminSupabase();

  const { data, error } = await db
    .from("onboarding_requests")
    .insert({
      email: input.email,
      company_name: input.companyName,
      competitor_urls: input.competitorUrls,
      goals: input.goals,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`No se pudo guardar la solicitud: ${error.message}`);
  }

  const requestId = (data as { id: string }).id;

  const rendered = renderOnboardingNotification({
    requestId,
    email: input.email,
    companyName: input.companyName,
    competitorUrls: input.competitorUrls,
    goals: input.goals,
    createdAt: now,
    timeZone: "America/Argentina/Buenos_Aires",
  });

  const send = await sendPlainTextEmail(
    { to: env.ADMIN_EMAIL, subject: rendered.subject, body: rendered.body, replyTo: input.email },
    { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM },
  );

  if (!send.ok) {
    await db.from("system_events").insert({
      level: "warning",
      source: "onboarding",
      message: `Solicitud ${requestId} guardada, pero no se pudo notificar al equipo: ${send.error}`,
      context: { requestId, email: input.email },
    });
  }

  return { id: requestId, adminNotified: send.ok };
}
