import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Event } from "@hetops-control/contracts";
import { follow, mergeEvents, SILENCE_MS } from "../src/lib/api.js";

class FakeSource {
  static CLOSED = 2; static all: FakeSource[] = [];
  readyState = 1; closed = false;
  onopen?: () => void; onmessage?: (m: { data: string }) => void; onerror?: () => void;
  constructor(public url: string) { FakeSource.all.push(this); }
  close() { this.closed = true; this.readyState = 2; }
}

describe("stream", () => {
  beforeEach(() => {
    vi.useFakeTimers(); FakeSource.all = [];
    vi.stubGlobal("EventSource", FakeSource);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("re-opens a stream that has gone silent, and says so", async () => {
    const link = vi.fn();
    const stop = follow({ state: () => {}, event: () => {}, link, events: () => {}, eventsFailed: () => {}, action: () => {} }, 6);
    FakeSource.all[0]!.onopen?.();
    vi.advanceTimersByTime(SILENCE_MS - 5000);
    expect(FakeSource.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);   // the watchdog checks the sign-in, then re-opens
    expect(FakeSource.all[0]!.closed).toBe(true);
    expect(FakeSource.all).toHaveLength(2);
    expect(link).toHaveBeenLastCalledWith(false);
    stop();
  });

  it("a sign-in that ended is said once, and the stream stops knocking", async () => {
    // Cloudflare Access answers a request without a session with a redirect to its login page; the stream cannot follow it
    const fetchMock = vi.fn(async (_: string, init?: RequestInit) => init?.redirect === "manual" ? { type: "opaqueredirect", status: 0 } : { ok: false, status: 503, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const signedOut = vi.fn();
    const stop = follow({ state: () => {}, event: () => {}, link: () => {}, events: () => {}, eventsFailed: () => {}, action: () => {}, signedOut }, 6);
    const es = FakeSource.all[0]!; es.readyState = FakeSource.CLOSED; es.onerror?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(signedOut).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SILENCE_MS * 3);
    expect(FakeSource.all).toHaveLength(1);   // no re-opens, no watchdog: only a sign-in brings it back
    stop();
  });

  it("a stream that drops while still signed in is re-opened", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_: string, init?: RequestInit) => init?.redirect === "manual" ? { type: "basic", status: 200 } : { ok: false, status: 503, json: async () => ({}) }));
    const signedOut = vi.fn();
    const stop = follow({ state: () => {}, event: () => {}, link: () => {}, events: () => {}, eventsFailed: () => {}, action: () => {}, signedOut }, 6);
    const es = FakeSource.all[0]!; es.readyState = FakeSource.CLOSED; es.onerror?.();
    await vi.advanceTimersByTimeAsync(3000);
    expect(signedOut).not.toHaveBeenCalled();
    expect(FakeSource.all).toHaveLength(2);
    stop();
  });

  it("a stream that keeps talking is left alone", () => {
    const stop = follow({ state: () => {}, event: () => {}, link: () => {}, events: () => {}, eventsFailed: () => {}, action: () => {} }, 6);
    for (let t = 0; t < 4; t++) { vi.advanceTimersByTime(15_000); FakeSource.all[0]!.onmessage?.({ data: "{}" }); }
    expect(FakeSource.all).toHaveLength(1);
    stop();
  });
});

describe("mergeEvents", () => {
  const ev = (at: string, summary: string, level?: Event["level"]): Event => ({ at, server: "lab", source: "k", kind: "status", summary, ...(level ? { level } : {}) });
  it("dedupes, keeps the held copy, newest first, capped", () => {
    const held = [ev("2026-10-30T03:00:00.000Z", "a", "attention")];
    const out = mergeEvents(held, [ev("2026-10-30T03:00:00.000Z", "a"), ev("2026-10-30T04:00:00.000Z", "b"), ev("2026-10-30T01:00:00.000Z", "c")], 2);
    expect(out.map(e => e.summary)).toEqual(["b", "a"]);
    expect(out[1]!.level).toBe("attention");
  });
});
