import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventLevel } from "./types";

/** Best-effort internal logging: never breaks the job that calls it. */
export async function logSystemEvent(
  db: SupabaseClient,
  event: {
    level: EventLevel;
    source: string;
    message: string;
    context?: Record<string, unknown>;
    competitorId?: string | null;
  },
): Promise<void> {
  const { error } = await db.from("system_events").insert({
    level: event.level,
    source: event.source,
    message: event.message.slice(0, 1000),
    context: event.context ?? {},
    competitor_id: event.competitorId ?? null,
  });

  if (error) {
    console.error(`[system_events] no se pudo registrar "${event.message}": ${error.message}`);
  }
}
