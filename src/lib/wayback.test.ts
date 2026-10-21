import { describe, expect, it, vi } from "vitest";

import {
  WaybackError,
  buildSnapshotUrl,
  findSnapshot,
  parseCdxRows,
  parseTimestamp,
  pickClosest,
} from "./wayback";

const NOW = new Date("2026-10-21T12:00:00.000Z");

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("parseCdxRows", () => {
  it("drops the header row and keeps only 200 snapshots", () => {
    const payload = [
      ["timestamp", "statuscode"],
      ["20260915000000", "200"],
      ["20260915010000", "301"],
      ["20260916000000", "200"],
      ["no-es-un-timestamp", "200"],
      ["20260917000000"],
    ];

    expect(parseCdxRows(payload)).toEqual(["20260915000000", "20260916000000"]);
  });

  it("returns an empty list for an empty archive or a non-array payload", () => {
    expect(parseCdxRows([])).toEqual([]);
    expect(parseCdxRows(null)).toEqual([]);
    expect(parseCdxRows({ rows: [] })).toEqual([]);
  });
});

describe("parseTimestamp", () => {
  it("interprets the CDX timestamp as UTC", () => {
    expect(parseTimestamp("20260915000000")?.toISOString()).toBe("2026-09-15T00:00:00.000Z");
    expect(parseTimestamp("20261021184530")?.toISOString()).toBe("2026-10-21T18:45:30.000Z");
  });

  it("rejects malformed values", () => {
    expect(parseTimestamp("2026-09-15")).toBeNull();
    expect(parseTimestamp("")).toBeNull();
  });
});

describe("buildSnapshotUrl", () => {
  it("builds a raw (id_) snapshot URL", () => {
    expect(buildSnapshotUrl("https://trello.com/pricing", "20260915000000")).toBe(
      "https://web.archive.org/web/20260915000000id_/https://trello.com/pricing",
    );
  });

  it("adds the scheme when the competitor URL was typed without it", () => {
    expect(buildSnapshotUrl("trello.com/pricing", "20260915000000")).toBe(
      "https://web.archive.org/web/20260915000000id_/https://trello.com/pricing",
    );
  });
});

describe("pickClosest", () => {
  const target = new Date("2026-09-21T00:00:00.000Z");

  it("picks the snapshot nearest to the target date, not the newest", () => {
    expect(
      pickClosest(["20260901000000", "20260919000000", "20261020000000"], target),
    ).toBe("20260919000000");
  });

  it("returns null when there is nothing usable", () => {
    expect(pickClosest([], target)).toBeNull();
    expect(pickClosest(["basura"], target)).toBeNull();
  });
});

describe("findSnapshot", () => {
  it("asks CDX for a 200-only window around the target date", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse([
        ["timestamp", "statuscode"],
        ["20260918000000", "200"],
        ["20260920000000", "200"],
      ]),
    );

    const snapshot = await findSnapshot("https://trello.com/pricing", {
      daysAgo: 30,
      windowDays: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: NOW,
    });

    const requested = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(requested.origin + requested.pathname).toBe(
      "https://web.archive.org/cdx/search/cdx",
    );
    expect(requested.searchParams.get("url")).toBe("trello.com/pricing");
    expect(requested.searchParams.get("from")).toBe("20260911");
    expect(requested.searchParams.get("to")).toBe("20261001");
    expect(requested.searchParams.get("filter")).toBe("statuscode:200");
    expect(requested.searchParams.get("collapse")).toBe("timestamp:8");

    expect(snapshot?.timestamp).toBe("20260920000000");
    expect(snapshot?.url).toBe(
      "https://web.archive.org/web/20260920000000id_/https://trello.com/pricing",
    );
    expect(snapshot?.archivedAt.toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });

  it("returns null when the site was not archived in the window", async () => {
    const snapshot = await findSnapshot("https://nunca-archivado.test/pricing", {
      fetchImpl: vi.fn(async (_url: string) => jsonResponse([])) as unknown as typeof fetch,
      now: NOW,
    });

    expect(snapshot).toBeNull();
  });

  it("throws WaybackError when the archive answers with an error", async () => {
    await expect(
      findSnapshot("https://trello.com/pricing", {
        fetchImpl: vi.fn(async (_url: string) => jsonResponse({}, 503)) as unknown as typeof fetch,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(WaybackError);
  });
});
