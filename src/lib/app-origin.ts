/**
 * De dónde sale el origen al que Supabase debe devolver el magic link.
 *
 * Usar `NEXT_PUBLIC_APP_URL` a secas obliga a reconfigurarlo en cada deploy
 * (el mismo código corre en local, en un preview de Vercel y en producción).
 * Los headers del request ya dicen dónde está corriendo la app, así que se
 * prefieren y la env queda como fallback.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

function firstValue(value: string): string {
  return value.split(",")[0]!.trim();
}

export function isLocalHost(host: string): boolean {
  const name = host.split(":")[0]!.toLowerCase();
  return LOCAL_HOSTS.has(name) || name.endsWith(".localhost");
}

export function resolveAppOrigin(input: {
  host?: string | null;
  proto?: string | null;
  fallback: string;
}): string {
  const rawHost = input.host?.trim() ? firstValue(input.host) : "";
  if (!rawHost) return input.fallback.replace(/\/+$/, "");

  const rawProto = input.proto?.trim() ? firstValue(input.proto) : "";
  const proto = (rawProto || (isLocalHost(rawHost) ? "http" : "https")).replace(/:$/, "");

  return `${proto}://${rawHost}`;
}
