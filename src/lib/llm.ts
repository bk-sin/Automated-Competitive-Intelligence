import { z } from "zod";
import type { AnalysisResult, AlertPriority } from "./types";
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserPrompt,
  type AnalysisPromptInput,
} from "./prompts";

export const MAX_BULLETS_PER_CATEGORY = 5;
const MAX_BULLET_CHARS = 240;
const MAX_HEADLINE_CHARS = 140;

export class AnalysisParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisParseError";
  }
}

export class LlmRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LlmRequestError";
    this.status = status;
  }
}

const rawAnalysisSchema = z.object({
  hasMeaningfulChange: z.boolean().optional(),
  priority: z.string().optional(),
  headline: z.string().optional(),
  precios: z.union([z.array(z.unknown()), z.string()]).optional(),
  posicionamiento: z.union([z.array(z.unknown()), z.string()]).optional(),
  productos: z.union([z.array(z.unknown()), z.string()]).optional(),
  reasoning: z.string().optional(),
});

function toBullets(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const seen = new Set<string>();
  const bullets: string[] = [];

  for (const item of items) {
    if (typeof item !== "string") continue;
    const clean = item.replace(/^\s*[-*•]\s*/, "").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    bullets.push(clean.slice(0, MAX_BULLET_CHARS));
    if (bullets.length >= MAX_BULLETS_PER_CATEGORY) break;
  }

  return bullets;
}

export function parsePriority(value: string | undefined, hasMeaningfulChange: boolean): AlertPriority {
  const normalised = (value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  if (["ALTA_PRIORIDAD", "ALTA", "HIGH", "CRITICA", "CRÍTICA", "URGENTE"].includes(normalised)) {
    return "ALTA_PRIORIDAD";
  }
  if (["MEDIA", "MEDIUM", "MODERADA", "MODERATE"].includes(normalised)) return "MEDIA";
  if (["BAJA", "LOW", "SIN_CAMBIO", "SIN_CAMBIOS", "NONE", "IRRELEVANTE"].includes(normalised)) {
    return "BAJA";
  }

  return hasMeaningfulChange ? "MEDIA" : "BAJA";
}

/** Locates the JSON object inside a model answer that may include prose/fences. */
export function extractJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end <= start) {
    throw new AnalysisParseError("La respuesta del modelo no contiene un objeto JSON");
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new AnalysisParseError(
      `JSON inválido en la respuesta del modelo: ${(error as Error).message}`,
    );
  }
}

export function normalizeAnalysis(raw: unknown): AnalysisResult {
  const parsed = rawAnalysisSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AnalysisParseError(
      `Esquema de análisis inválido: ${parsed.error.issues[0]?.message ?? "desconocido"}`,
    );
  }

  const value = parsed.data;
  const precios = toBullets(value.precios);
  const posicionamiento = toBullets(value.posicionamiento);
  const productos = toBullets(value.productos);
  const hasFindings = precios.length + posicionamiento.length + productos.length > 0;
  const hasMeaningfulChange = value.hasMeaningfulChange ?? hasFindings;

  if (!hasMeaningfulChange || !hasFindings) {
    return {
      hasMeaningfulChange: false,
      priority: "BAJA",
      headline: "Sin cambios accionables",
      precios: [],
      posicionamiento: [],
      productos: [],
      reasoning: value.reasoning?.slice(0, 300),
    };
  }

  const headline =
    value.headline?.replace(/\s+/g, " ").trim().slice(0, MAX_HEADLINE_CHARS) ||
    "Cambios detectados en el sitio del competidor";

  return {
    hasMeaningfulChange: true,
    priority: parsePriority(value.priority, hasMeaningfulChange),
    headline,
    precios,
    posicionamiento,
    productos,
    reasoning: value.reasoning?.slice(0, 300),
  };
}

/** Entry point used by the extraction job. */
export function parseAnalysisResponse(raw: string): AnalysisResult {
  return normalizeAnalysis(extractJsonObject(raw));
}

// ---------------------------------------------------------------------------
// HTTP client (OpenAI-compatible /chat/completions)
// ---------------------------------------------------------------------------

export type LlmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  maxAttempts?: number;
};

export type LlmDeps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export type LlmAnalysisResponse = {
  analysis: AnalysisResult;
  raw: string;
  model: string;
  tokensUsed: number | null;
  attempts: number;
};

type ChatCompletionPayload = {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { total_tokens?: number };
};

const CORRECTION_MESSAGE =
  "Tu respuesta anterior no fue un JSON válido según el esquema. Respondé de nuevo SOLO con el objeto JSON, sin texto ni markdown.";

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 30_000);
  }
  // 1s, 2s, 4s ... capped at 20s (LLM 429 per the error-handling table).
  return Math.min(1000 * 2 ** (attempt - 1), 20_000);
}

/**
 * Sends the diff to the LLM and returns a validated analysis.
 * Retries on 429/5xx and on malformed JSON, mirroring the spec's
 * "Límite de Tokens LLM -> Reintento con retraso" rule.
 */
export async function analyzeDiff(
  input: AnalysisPromptInput,
  config: LlmConfig,
  deps: LlmDeps = {},
): Promise<LlmAnalysisResponse> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const maxAttempts = Math.max(1, config.maxAttempts ?? 3);
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  let lastParseError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
      { role: "user", content: buildAnalysisUserPrompt(input) },
    ];

    if (lastParseError) {
      messages.push({ role: "assistant", content: "(respuesta inválida)" });
      messages.push({ role: "user", content: CORRECTION_MESSAGE });
    }

    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages,
      }),
      signal: AbortSignal.timeout(config.timeoutMs ?? 60_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const retryable = response.status === 429 || response.status >= 500;

      if (retryable && attempt < maxAttempts) {
        await sleep(retryDelayMs(attempt, response.headers.get("retry-after")));
        continue;
      }

      throw new LlmRequestError(
        `LLM respondió ${response.status}: ${body.slice(0, 300)}`,
        response.status,
      );
    }

    const payload = (await response.json()) as ChatCompletionPayload;
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new AnalysisParseError("El LLM devolvió una respuesta vacía");
    }

    try {
      return {
        analysis: parseAnalysisResponse(content),
        raw: content,
        model: payload.model ?? config.model,
        tokensUsed: payload.usage?.total_tokens ?? null,
        attempts: attempt,
      };
    } catch (error) {
      if (!(error instanceof AnalysisParseError)) throw error;
      lastParseError = error;
      if (attempt === maxAttempts) throw error;
    }
  }

  throw lastParseError ?? new AnalysisParseError("No se pudo obtener un análisis válido");
}
