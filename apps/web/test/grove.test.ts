import { describe, expect, it } from "vitest";
import type { Entity } from "@hetops-control/contracts";
import { grow, groveOf, plant } from "../src/lib/grove.js";
import type { Reading } from "../src/lib/burn.js";

const app = (server: Entity["server"], ns: string, name: string, pods = 1, ready = pods): Entity => ({ id: `${server}/app/${ns}/${name}`, kind: "app", server, name, status: "ok",
  facts: { namespace: { value: ns }, pods: { value: ready, max: pods }, podsDesired: { value: pods } }, links: [], actions: [], observedAt: "2026-11-10T07:42:00Z" });

describe("grow", () => {
  it("draws the same tree for the same seed, a different one for another", () => {
    expect(grow("lab/app/chaos/chaos-api")).toEqual(grow("lab/app/chaos/chaos-api"));
    expect(grow("lab/app/chaos/chaos-api").trunk).not.toBe(grow("lab/app/clinic/api").trunk);
  });
  it("has roots, branches and a full canopy; a burning tree keeps only part of it", () => {
    const t = grow("x"); expect(t.roots.split("M").length - 1).toBe(5); expect(t.branches.split("M").length - 1).toBe(7);
    expect(t.leaves.length).toBe(8 * 16);
    expect(grow("x", .4).leaves.length).toBeLessThan(t.leaves.length * .6);
  });
});

describe("plant", () => {
  const apps = [app("lab", "chaos", "chaos-api", 2), app("lab", "chaos", "chaos-ui"), app("lab", "clinic", "api", 3), app("ops", "control", "center")];
  it("groups each server's apps into groves by namespace, biggest first", () => {
    const [lab, staging, ops] = plant(apps, new Map());
    expect(lab!.groves.map(g => g.name)).toEqual(["chaos", "clinic"]);
    expect(staging!.groves).toEqual([]);
    expect(ops!.groves[0]!.trees.map(t => t.name)).toEqual(["center"]);
  });
  it("keeps a tree in the same place across calls, and draws back to front", () => {
    const a = plant(apps, new Map())[0]!.groves[0]!.trees, b = plant(apps, new Map())[0]!.groves[0]!.trees;
    expect(a.map(t => [t.x, t.y])).toEqual(b.map(t => [t.x, t.y]));
    expect(a.map(t => t.y)).toEqual([...a.map(t => t.y)].sort((x, y) => x - y));
  });
  it("burns away the leaves of the pods that are not ready", () => {
    const sick = app("lab", "chaos", "chaos-api", 2, 1), fire: Reading = { burn: "fire", hot: false };
    const t = plant([sick], new Map([[sick.id, fire]]))[0]!.groves[0]!.trees[0]!;
    expect(t.leaves.length).toBeLessThan(grow(sick.id).leaves.length * .7);
  });
  it("zooms one server to fill the frame with bigger trees", () => {
    const one = plant(apps, new Map(), "lab"); expect(one).toHaveLength(1);
    expect(one[0]!.groves[0]!.trees[0]!.w).toBeGreaterThan(plant(apps, new Map())[0]!.groves[0]!.trees[0]!.w);
  });
  it("puts an app with no namespace in its platform's grove", () => {
    expect(groveOf({ ...app("ops", "x", "y"), facts: {}, source: "coolify" })).toBe("coolify");
  });
});
