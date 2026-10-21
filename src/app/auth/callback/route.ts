import { NextResponse, type NextRequest } from "next/server";
import { authLinkErrorMessage } from "@/lib/auth-link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function backToLogin(url: URL, message: string) {
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, url.origin));
}

/**
 * Supabase magic-link callback: exchanges the code for a session cookie.
 *
 * Se llega acá incluso cuando Supabase ignora el `redirect_to` (no está en la
 * lista blanca) y devuelve el código a la home: el middleware reenvía.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next");
  const next = nextParam?.startsWith("/") ? nextParam : "/dashboard";

  // Supabase manda los fallos como query params (otp_expired, access_denied...).
  const errorCode = url.searchParams.get("error_code") ?? url.searchParams.get("error");
  if (errorCode) {
    return backToLogin(url, authLinkErrorMessage({ errorCode }));
  }

  if (!code) {
    return backToLogin(url, "El link venía incompleto. Pedí uno nuevo.");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (!error) {
    return NextResponse.redirect(new URL(next, url.origin));
  }

  console.error("[auth/callback] no se pudo canjear el código:", error.message);
  return backToLogin(url, authLinkErrorMessage({ exchangeFailed: error.message }));
}

