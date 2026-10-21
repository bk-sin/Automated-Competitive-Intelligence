/**
 * Wayback Machine (CDX API) — de dónde sale un baseline honesto.
 *
 * Un competidor nuevo no tiene historial propio: la primera extracción es solo
 * una línea base, así que no hay "cambios" que reportar. Inventar el pasado
 * (correr precios -10%) sirve para un demo, nunca para un email a un prospecto
 * real que puede abrir la web y ver otra cosa.
 *
 * El archivo público sí tiene el pasado: se busca el snapshot más cercano a
 * "hace N días" y se compara contra la página de hoy con el mismo motor de diff.
 * Si el sitio no está archivado, se dice que no se pudo comparar; jamás se
 * reporta "sin cambios".
 */

export class WaybackError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "WaybackError";
    this.status = status;
  }
}

export type WaybackSnapshot = {
  /** Formato CDX: YYYYMMDDhhmmss. */
  timestamp: string;
  archivedAt: Date;
  /** URL del snapshot en crudo (`id_`), la que hay que scrapear. */
  url: string;
};

export type FindSnapshotOptions = {
  /** Antigüedad buscada, en días. Default 30. */
  daysAgo?: number;
  /** Tolerancia alrededor de esa fecha, en días. Default 10. */
  windowDays?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Inyectable para tests. */
  now?: Date;
};

const CDX_ENDPOINT = "https://web.archive.org/cdx/search/cdx";
const TIMESTAMP_PATTERN = /^\d{14}$/;
const DAY_MS = 86_400_000;

/**
 * CDX devuelve un array de arrays y la primera fila es el encabezado de las
 * columnas pedidas con `fl`. Se descarta todo lo que no sea un 200 con
 * timestamp válido: un 301 archivado no es la página, es un redirect.
 */
export function parseCdxRows(payload: unknown): string[] {
  if (!Array.isArray(payload) || payload.length === 0) return [];

  const timestamps: string[] = [];

  for (const row of payload.slice(1)) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const [timestamp, status] = row as unknown[];
    if (typeof timestamp !== "string" || !TIMESTAMP_PATTERN.test(timestamp)) continue;
    if (String(status) !== "200") continue;
    timestamps.push(timestamp);
  }

  return timestamps;
}

export function parseTimestamp(timestamp: string): Date | null {
  if (!TIMESTAMP_PATTERN.test(timestamp)) return null;

  const date = new Date(
    Date.UTC(
      Number(timestamp.slice(0, 4)),
      Number(timestamp.slice(4, 6)) - 1,
      Number(timestamp.slice(6, 8)),
      Number(timestamp.slice(8, 10)),
      Number(timestamp.slice(10, 12)),
      Number(timestamp.slice(12, 14)),
    ),
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

/** `id_` devuelve el documento original sin la barra de herramientas del archivo. */
export function buildSnapshotUrl(pageUrl: string, timestamp: string): string {
  const absolute = /^https?:\/\//i.test(pageUrl) ? pageUrl : `https://${pageUrl}`;
  return `https://web.archive.org/web/${timestamp}id_/${absolute}`;
}

export function pickClosest(timestamps: readonly string[], target: Date): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const timestamp of timestamps) {
    const date = parseTimestamp(timestamp);
    if (!date) continue;
    const distance = Math.abs(date.getTime() - target.getTime());
    if (distance < bestDistance) {
      best = timestamp;
      bestDistance = distance;
    }
  }

  return best;
}

function formatCdxDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Devuelve el snapshot más cercano a `now - daysAgo`, o null si el sitio no
 * está archivado en esa ventana. Nunca lanza por "no hay snapshot": eso es un
 * resultado legítimo que el llamador reporta como "no comparable".
 */
export async function findSnapshot(
  pageUrl: string,
  options: FindSnapshotOptions = {},
): Promise<WaybackSnapshot | null> {
  const daysAgo = Math.max(1, options.daysAgo ?? 30);
  const windowDays = Math.max(0, options.windowDays ?? 10);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? new Date();

  const target = new Date(now.getTime() - daysAgo * DAY_MS);
  const params = new URLSearchParams({
    url: pageUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, ""),
    from: formatCdxDate(new Date(target.getTime() - windowDays * DAY_MS)),
    to: formatCdxDate(new Date(target.getTime() + windowDays * DAY_MS)),
    output: "json",
    fl: "timestamp,statuscode",
    filter: "statuscode:200",
    collapse: "timestamp:8",
  });

  const response = await fetchImpl(`${CDX_ENDPOINT}?${params.toString()}`, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  }).catch((error: unknown) => {
    throw new WaybackError(`No se pudo consultar Wayback: ${(error as Error).message}`, 0);
  });

  if (!response.ok) {
    throw new WaybackError(`Wayback respondió ${response.status}`, response.status);
  }

  const payload = await response.json().catch(() => null);
  const timestamp = pickClosest(parseCdxRows(payload), target);
  if (!timestamp) return null;

  const archivedAt = parseTimestamp(timestamp);
  if (!archivedAt) return null;

  return { timestamp, archivedAt, url: buildSnapshotUrl(pageUrl, timestamp) };
}
