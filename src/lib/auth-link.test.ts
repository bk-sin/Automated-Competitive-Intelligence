import { describe, expect, it } from "vitest";
import { authLinkErrorMessage } from "./auth-link";

describe("authLinkErrorMessage", () => {
  it("says the link expired when Supabase reports otp_expired", () => {
    expect(authLinkErrorMessage({ errorCode: "otp_expired" })).toBe(
      "El link venció. Pedí uno nuevo.",
    );
  });

  it("says the link was already used when Supabase reports access_denied", () => {
    expect(authLinkErrorMessage({ errorCode: "access_denied" })).toBe(
      "Ese link ya se usó. Pedí uno nuevo.",
    );
  });

  it("explains the PKCE trap instead of blaming the link", () => {
    expect(
      authLinkErrorMessage({
        exchangeFailed: "invalid request: both auth code and code verifier should be non-empty",
      }),
    ).toBe("Abrí el link en el mismo navegador donde lo pediste; si no, pedí uno nuevo.");
  });

  it("keeps the expired message for a failed exchange", () => {
    expect(authLinkErrorMessage({ exchangeFailed: "Token has expired or is invalid" })).toBe(
      "El link venció. Pedí uno nuevo.",
    );
  });

  it("never leaks the raw error to the user", () => {
    const message = authLinkErrorMessage({ exchangeFailed: "unexpected_failure: 500" });
    expect(message).toBe("No pudimos validar el link. Pedí uno nuevo.");
    expect(message).not.toContain("500");
  });
});
