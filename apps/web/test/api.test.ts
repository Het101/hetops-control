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

  it("re-opens a stream that has gone silent, and says so", () => {
    const link = vi.fn();
    const stop = follow({ state: () => {}, event: () => {}, link, events: () => {}, eventsFailed: () => {} }, 6);
    FakeSource.all[0]!.onopen?.();
    vi.advanceTimersByTime(SILENCE_MS - 5000);
    expect(FakeSource.all).toHaveLength(1);
    vi.advanceTimersByTime(10_000);
    expect(FakeSource.all[0]!.closed).toBe(true);
    expect(FakeSource.all).toHaveLength(2);
    expect(link).toHaveBeenLastCalledWith(false);
    stop();
  });

  it("a stream that keeps talking is left alone", () => {
    const stop = follow({ state: () => {}, event: () => {}, link: () => {}, events: () => {}, eventsFailed: () => {} }, 6);
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
