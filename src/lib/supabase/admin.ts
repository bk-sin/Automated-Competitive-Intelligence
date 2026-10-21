import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "../env";

let cachedClient: SupabaseClient | null = null;

/**
 * Service-role client: bypasses RLS. Server-side only (jobs, cron routes,
 * server actions). Never import this from a client component.
 */
export function getAdminSupabase(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const env = getServerEnv();
  cachedClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-application-name": "competitive-intelligence" } },
    },
  );

  return cachedClient;
}
