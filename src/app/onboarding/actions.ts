"use server";

import { redirect } from "next/navigation";
import { createOnboardingRequest, parseOnboardingFormData } from "@/lib/onboarding";

/**
 * FR-001: persists the request and notifies the internal team.
 * Validation errors bounce back to the form with a readable message.
 */
export async function submitOnboardingAction(formData: FormData): Promise<void> {
  const parsed = parseOnboardingFormData(formData);

  if (!parsed.ok) {
    redirect(`/onboarding?error=${encodeURIComponent(parsed.error)}`);
  }

  try {
    await createOnboardingRequest(parsed.value);
  } catch (error) {
    console.error("[onboarding] no se pudo registrar la solicitud:", error);
    redirect(
      `/onboarding?error=${encodeURIComponent(
        "No pudimos registrar tu solicitud. Probá de nuevo en unos minutos.",
      )}`,
    );
  }

  redirect("/onboarding/gracias");
}
