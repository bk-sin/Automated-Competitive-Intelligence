import { describe, expect, it } from "vitest";
import {
  MAX_COMPETITORS,
  normalizeUrl,
  parseCompetitorUrls,
  parseOnboardingFormData,
} from "./onboarding";

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("normalizeUrl", () => {
  it("adds the scheme when it is missing", () => {
    expect(normalizeUrl("acme.com")).toBe("https://acme.com");
  });

  it("keeps an existing scheme and removes the trailing slash", () => {
    expect(normalizeUrl("http://acme.com/precios/")).toBe("http://acme.com/precios");
  });

  it("rejects values that are not hostnames", () => {
    expect(normalizeUrl("no es una url")).toBeNull();
    expect(normalizeUrl("localhost")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
  });
});

describe("parseCompetitorUrls", () => {
  it("splits on newlines and commas, deduplicating", () => {
    expect(parseCompetitorUrls("acme.com\nhttps://initech.io, acme.com")).toEqual([
      "https://acme.com",
      "https://initech.io",
    ]);
  });

  it("drops invalid entries", () => {
    expect(parseCompetitorUrls("acme.com\nnope\n")).toEqual(["https://acme.com"]);
  });
});

describe("parseOnboardingFormData", () => {
  const valid = {
    companyName: "Acme SaaS",
    email: "founder@acme.com",
    competitors: "https://globex.com\ninitech.io",
    goals: "Precios de los planes Pro",
  };

  it("accepts a valid submission", () => {
    const result = parseOnboardingFormData(formData(valid));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.competitorUrls).toHaveLength(2);
      expect(result.value.competitorUrls[1]).toBe("https://initech.io");
      expect(result.value.goals).toBe("Precios de los planes Pro");
    }
  });

  it("defaults goals to an empty string", () => {
    const result = parseOnboardingFormData(formData({ ...valid, goals: "" }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.goals).toBe("");
  });

  it("rejects an invalid URL with the message from the error table", () => {
    const result = parseOnboardingFormData(
      formData({ ...valid, competitors: "https://globex.com\nno-es-una-url" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Por favor ingrese una URL válida para cada competidor");
  });

  it("rejects an invalid email", () => {
    const result = parseOnboardingFormData(formData({ ...valid, email: "no-es-email" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Por favor ingrese un email válido");
  });

  it("requires at least one competitor", () => {
    const result = parseOnboardingFormData(formData({ ...valid, competitors: "" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Ingresá al menos un competidor");
  });

  it("caps the number of competitors", () => {
    const urls = Array.from({ length: MAX_COMPETITORS + 1 }, (_, index) => `competidor${index}.com`);
    const result = parseOnboardingFormData(
      formData({ ...valid, competitors: urls.join("\n") }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(`hasta ${MAX_COMPETITORS}`);
  });
});
