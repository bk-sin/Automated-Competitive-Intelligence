"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveAppOrigin } from "@/lib/app-origin";
import { getPublicEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Magic-link sign in (Supabase Auth). */
export async function signInAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!email.includes("@") || email.length < 5) {
    redirect(`/login?error=${encodeURIComponent("Ingresá un email válido")}`);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const headerList = await headers();

    // El origen sale del request: en producción no depende de que
    // NEXT_PUBLIC_APP_URL esté bien cargado en cada entorno.
    const origin = resolveAppOrigin({
      host: headerList.get("x-forwarded-host") ?? headerList.get("host"),
      proto: headerList.get("x-forwarded-proto"),
      fallback: getPublicEnv().NEXT_PUBLIC_APP_URL,
    });

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });


    if (error) {
      console.error("[login] Supabase rechazó el magic link:", error.message);
      redirect(
        `/login?error=${encodeURIComponent("No pudimos enviar el link. Probá de nuevo.")}`,
      );
    }
  } catch (error) {
    console.error("[login] error inesperado:", error);
    redirect(`/login?error=${encodeURIComponent("No pudimos enviar el link.")}`);
  }

  redirect("/login?sent=1");
}
