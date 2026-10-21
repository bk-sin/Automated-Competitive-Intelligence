import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv, isPublicEnvConfigured } from "@/lib/env";

/**
 * Refreshes the Supabase session cookie on every matched request and keeps
 * /dashboard behind magic-link auth (NFR Security).
 *
 * Reads the keys through src/lib/env.ts so both Supabase namings work
 * (legacy anon/service_role and the new publishable/secret keys).
 */
export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // El link del magic link puede caer en cualquier ruta: si el `redirect_to` no
  // está en la lista blanca de Supabase (o el Site URL del proyecto no apunta al
  // callback), el código llega a la home, a /login o a /dashboard. Se reenvía al
  // callback en vez de perder la sesión, que es lo que pasaba antes.
  const code = searchParams.get("code");
  if (code && pathname !== "/auth/callback") {
    const target = request.nextUrl.clone();
    target.pathname = "/auth/callback";
    target.search = "";
    target.searchParams.set("code", code);

    const next = searchParams.get("next");
    if (next?.startsWith("/")) target.searchParams.set("next", next);

    return NextResponse.redirect(target);
  }

  const needsAuth =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth");

  if (!needsAuth) {
    // La landing es pública: no se toca Supabase para no pagar un round trip.
    return NextResponse.next({ request });
  }

  if (!isPublicEnvConfigured()) {
    // Misconfigured deployment: let the page render its own notice.
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const env = getPublicEnv();

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith("/dashboard")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  // "/" entra al matcher sólo para rescatar un `?code=` que Supabase dejó en el
  // Site URL; el resto de la landing sale sin tocar la sesión.
  matcher: ["/", "/dashboard/:path*", "/login", "/auth/:path*"],
};
