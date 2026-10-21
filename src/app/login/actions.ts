"use server";

import { redirect } from "next/navigation";
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
    const env = getPublicEnv();

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback` },
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
