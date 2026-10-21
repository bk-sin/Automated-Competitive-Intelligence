import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Supabase magic-link callback: exchanges the code for a session cookie. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const target = next.startsWith("/") ? next : "/dashboard";
      return NextResponse.redirect(new URL(target, url.origin));
    }

    console.error("[auth/callback] no se pudo canjear el código:", error.message);
  }

  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent("El link venció. Pedí uno nuevo.")}`, url.origin),
  );
}
