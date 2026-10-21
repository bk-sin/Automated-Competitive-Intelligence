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
  matcher: ["/dashboard/:path*", "/login", "/auth/:path*"],
};
