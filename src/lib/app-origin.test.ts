import { describe, expect, it } from "vitest";
import { isLocalHost, resolveAppOrigin } from "./app-origin";

describe("resolveAppOrigin", () => {
  it("uses the forwarded host and proto in production", () => {
    expect(
      resolveAppOrigin({
        host: "radar.example.com",
        proto: "https",
        fallback: "http://localhost:3000",
      }),
    ).toBe("https://radar.example.com");
  });

  it("defaults localhost to http when the proxy sends no proto", () => {
    expect(
      resolveAppOrigin({ host: "localhost:3000", proto: null, fallback: "https://prod.example.com" }),
    ).toBe("http://localhost:3000");
  });

  it("defaults a real host to https when the proxy sends no proto", () => {
    expect(
      resolveAppOrigin({
        host: "inteligencia-competitiva.vercel.app",
        proto: null,
        fallback: "http://localhost:3000",
      }),
    ).toBe("https://inteligencia-competitiva.vercel.app");
  });

  it("falls back to NEXT_PUBLIC_APP_URL without a trailing slash", () => {
    expect(resolveAppOrigin({ host: null, proto: null, fallback: "http://localhost:3000/" })).toBe(
      "http://localhost:3000",
    );
  });

  it("keeps only the first value of the proxy header lists", () => {
    expect(
      resolveAppOrigin({
        host: "radar.example.com, proxy.internal",
        proto: "https, http",
        fallback: "http://localhost:3000",
      }),
    ).toBe("https://radar.example.com");
  });

  it("treats loopback addresses as local", () => {
    expect(isLocalHost("127.0.0.1:3000")).toBe(true);
    expect(isLocalHost("radar.example.com")).toBe(false);
  });
});
