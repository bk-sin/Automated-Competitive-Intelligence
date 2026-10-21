import { createHash } from "node:crypto";

/**
 * Deterministic markdown pre-processing + line diff.
 *
 * Goal (NFR "Herramientas gratuitas"): never send full HTML to the LLM.
 * We collapse navigation/chrome noise, normalise formatting and send only
 * the added/removed lines, price changes first.
 *
 * Everything here is pure and synchronous so it can be unit tested.
 */

export type LineKind = "heading" | "list" | "price" | "text";

export type SegmentedLine = {
  kind: LineKind;
  text: string;
};

export type ContentDiff = {
  changed: boolean;
  added: string[];
  removed: string[];
  /** Jaccard similarity of the normalised line sets, 0..1. */
  similarity: number;
  beforeCount: number;
  afterCount: number;
};

const NOISE_PATTERNS: readonly RegExp[] = [
  /^(aceptar|rechazar)( todas las)? cookies$/i,
  /^utilizamos cookies/i,
  /^este sitio (web )?utiliza cookies/i,
  /^pol[ií]tica de (privacidad|cookies)/i,
  /^t[eé]rminos y condiciones/i,
  /^todos los derechos reservados/i,
  /^©\s?\d{4}/i,
  /^(iniciar|cerrar) sesi[oó]n$/i,
  /^(mi|tu) cuenta$/i,
  /^(crear|registrar)( una)? cuenta$/i,
  /^(ver|mi) carrito$/i,
  /^a[nñ]adir al carrito$/i,
  /^(suscr[ií]b(ete|irse)|newsletter|recib[ií] nuestras novedades)/i,
  /^(seguinos|s[ií]guenos|compartir)( en)?/i,
  /^(men[uú]|buscar|b[uú]squeda)$/i,
  /^(home|inicio)$/i,
  /^skip to (main )?content$/i,
];

const SEPARATOR_PATTERN = /^[-=_*~·•\s]{3,}$/;
const IMAGE_ONLY_PATTERN = /^!\[[^\]]*\]\([^)]*\)$/;
const PRICE_PATTERN =
  /(?:^|\s)(?:\$|€|£)\s?\d|\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s?(?:usd|ars|mxn|clp|cop|pen|eur|u\$s)\b|\b(?:usd|ars|mxn|clp|cop|pen|eur)\s?\d|\bprecios?\b/i;

/** Removes markdown link targets/emphasis so only readable text is compared. */
export function stripMarkdownDecorations(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoiseLine(line: string): boolean {
  if (!line) return true;
  if (SEPARATOR_PATTERN.test(line)) return true;
  if (IMAGE_ONLY_PATTERN.test(line)) return true;
  if (NOISE_PATTERNS.some((pattern) => pattern.test(line))) return true;

  // "Home | Productos | Contacto" style bars: 3+ short segments, no sentence.
  const segments = line.split(/\s*[|·•/]\s*/).filter(Boolean);
  if (segments.length >= 3 && line.split(" ").length <= 8) return true;

  return false;
}

/**
 * Turns raw markdown into a stable list of comparable lines.
 * - strips link URLs / emphasis / inline HTML
 * - drops navigation, cookie banners, separators
 * - removes duplicates (a page repeating a price 40 times is one fact)
 */
export function normalizeLines(markdown: string): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = stripMarkdownDecorations(rawLine);
    if (isNoiseLine(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }

  return lines;
}

export function segmentLines(lines: readonly string[]): SegmentedLine[] {
  return lines.map((line) => {
    if (/^#{1,6}\s/.test(line) || line === line.toUpperCase()) {
      return { kind: "heading", text: line };
    }
    if (/^([-+*]|\d+\.)\s/.test(line)) return { kind: "list", text: line };
    if (PRICE_PATTERN.test(line)) return { kind: "price", text: line };
    return { kind: "text", text: line };
  });
}

export function hashLines(lines: readonly string[]): string {
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export function hashContent(markdown: string): string {
  return hashLines(normalizeLines(markdown));
}

export function isPriceLine(line: string): boolean {
  return PRICE_PATTERN.test(line);
}

function setDiff(
  before: readonly string[],
  after: readonly string[],
): Pick<ContentDiff, "added" | "removed"> {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((line) => !beforeSet.has(line)),
    removed: before.filter((line) => !afterSet.has(line)),
  };
}

/**
 * Longest-common-subsequence diff with a hard cap so a pathological page
 * cannot blow up memory. Beyond the cap we fall back to a set comparison.
 */
function diffSequences(
  before: readonly string[],
  after: readonly string[],
): Pick<ContentDiff, "added" | "removed"> {
  const MAX_LINES = 1200;
  const n = before.length;
  const m = after.length;

  if (n === 0) return { added: [...after], removed: [] };
  if (m === 0) return { added: [], removed: [...before] };
  if (n > MAX_LINES || m > MAX_LINES) return setDiff(before, after);

  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        before[i] === after[j]
          ? (table[(i + 1) * width + (j + 1)] ?? 0) + 1
          : Math.max(
              table[(i + 1) * width + j] ?? 0,
              table[i * width + (j + 1)] ?? 0,
            );
    }
  }

  const added: string[] = [];
  const removed: string[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (before[i] === after[j]) {
      i += 1;
      j += 1;
    } else if (
      (table[(i + 1) * width + j] ?? 0) >= (table[i * width + (j + 1)] ?? 0)
    ) {
      removed.push(before[i] as string);
      i += 1;
    } else {
      added.push(after[j] as string);
      j += 1;
    }
  }

  while (i < n) {
    removed.push(before[i] as string);
    i += 1;
  }
  while (j < m) {
    added.push(after[j] as string);
    j += 1;
  }

  return { added, removed };
}

function jaccard(before: readonly string[], after: readonly string[]): number {
  if (before.length === 0 && after.length === 0) return 1;
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  let intersection = 0;
  for (const line of beforeSet) {
    if (afterSet.has(line)) intersection += 1;
  }
  const union = beforeSet.size + afterSet.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

export function diffContent(beforeMarkdown: string, afterMarkdown: string): ContentDiff {
  const before = normalizeLines(beforeMarkdown);
  const after = normalizeLines(afterMarkdown);
  const { added, removed } = diffSequences(before, after);

  return {
    changed: added.length > 0 || removed.length > 0,
    added,
    removed,
    similarity: jaccard(before, after),
    beforeCount: before.length,
    afterCount: after.length,
  };
}

export type DiffContextOptions = {
  /** Hard character budget for the prompt fragment. */
  maxChars?: number;
  maxLines?: number;
};

export type DiffContext = {
  text: string;
  truncated: boolean;
  priceChanges: number;
  totalChanges: number;
};

/**
 * Builds the compact "- old / + new" block sent to the LLM.
 * Price changes are listed first because they drive priority decisions.
 */
export function buildDiffContext(
  diff: ContentDiff,
  options: DiffContextOptions = {},
): DiffContext {
  const maxChars = options.maxChars ?? 3500;
  const maxLines = options.maxLines ?? 60;

  const removedPrices = diff.removed.filter(isPriceLine);
  const addedPrices = diff.added.filter(isPriceLine);
  const removedRest = diff.removed.filter((line) => !isPriceLine(line));
  const addedRest = diff.added.filter((line) => !isPriceLine(line));

  const ordered = [
    ...removedPrices.map((line) => `- ${line}`),
    ...addedPrices.map((line) => `+ ${line}`),
    ...removedRest.map((line) => `- ${line}`),
    ...addedRest.map((line) => `+ ${line}`),
  ];

  const kept: string[] = [];
  let used = 0;
  let truncated = false;

  for (const line of ordered) {
    if (kept.length >= maxLines) {
      truncated = true;
      break;
    }
    const cost = line.length + 1;
    if (used + cost > maxChars) {
      truncated = true;
      break;
    }
    kept.push(line);
    used += cost;
  }

  if (truncated) {
    kept.push(`(... ${ordered.length - kept.length} líneas adicionales omitidas)`);
  }

  return {
    text: kept.join("\n"),
    truncated,
    priceChanges: removedPrices.length + addedPrices.length,
    totalChanges: diff.added.length + diff.removed.length,
  };
}
