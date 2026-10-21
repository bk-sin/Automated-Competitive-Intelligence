/**
 * Un magic link puede fallar por tres motivos muy distintos, y el usuario
 * necesita saber cuál: el link venció, ya se usó, o se abrió en otro navegador
 * (PKCE guarda el verificador en una cookie del navegador que lo pidió).
 * Un único "el link venció" manda a la persona a repetir el intento equivocado.
 */
export function authLinkErrorMessage(input: {
  errorCode?: string | null;
  exchangeFailed?: string | null;
}): string {
  const code = input.errorCode?.toLowerCase() ?? "";

  if (code === "otp_expired") return "El link venció. Pedí uno nuevo.";
  if (code === "access_denied") return "Ese link ya se usó. Pedí uno nuevo.";

  const detail = input.exchangeFailed?.toLowerCase() ?? "";
  if (/verifier|pkce/.test(detail)) {
    return "Abrí el link en el mismo navegador donde lo pediste; si no, pedí uno nuevo.";
  }
  if (/expired|invalid|not found/.test(detail)) return "El link venció. Pedí uno nuevo.";

  return "No pudimos validar el link. Pedí uno nuevo.";
}
