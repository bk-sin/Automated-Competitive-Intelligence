/**
 * Firecrawl client (https://docs.firecrawl.dev).
 * Only the /v2/scrape endpoint is needed for the MVP: markdown output,
 * visible content only, no screenshots.
 */

export type ScrapeResult = {
  markdown: string;
  httpStatus: number | null;
  durationMs: number;
};

export class FirecrawlError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = "FirecrawlError";
    this.status = status;
    this.url = url;
  }
}

export type FirecrawlConfig = {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
};

type ScrapePayload = {
  success?: boolean;
  data?: {
    markdown?: string;
    metadata?: { statusCode?: number };
  };
  error?: string;
};

export async function scrapeUrl(
  url: string,
  config: FirecrawlConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ScrapeResult> {
  const baseUrl = (config.baseUrl ?? "https://api.firecrawl.dev").replace(/\/+$/, "");
  const startedAt = Date.now();

  const response = await fetchImpl(`${baseUrl}/v2/scrape`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      timeout: config.timeoutMs ?? 45_000,
    }),
    signal: AbortSignal.timeout((config.timeoutMs ?? 45_000) + 5_000),
  });

  const durationMs = Date.now() - startedAt;
  const body = (await response.json().catch(() => null)) as ScrapePayload | null;

  if (!response.ok || body?.success === false) {
    const message =
      body?.error ??
      (body ? "Firecrawl devolvió success=false" : `HTTP ${response.status}`);
    throw new FirecrawlError(message.slice(0, 500), response.status, url);
  }

  const markdown = body?.data?.markdown;
  if (!markdown || markdown.trim().length === 0) {
    throw new FirecrawlError("Firecrawl no devolvió contenido markdown", 204, url);
  }

  return {
    markdown,
    httpStatus: body?.data?.metadata?.statusCode ?? response.status,
    durationMs,
  };
}
