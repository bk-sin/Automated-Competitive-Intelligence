import { timingSafeEqual } from "node:crypto";

/**
 * Cron endpoints are public URLs, so they are protected by a shared secret
 * sent as `Authorization: Bearer <CRON_SECRET>` (constant-time compare).
 */
export function isAuthorizedCron(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";

  if (!provided || !secret) return false;

  const providedBuffer = Buffer.from(provided);
  const secretBuffer = Buffer.from(secret);

  if (providedBuffer.length !== secretBuffer.length) return false;

  return timingSafeEqual(providedBuffer, secretBuffer);
}
