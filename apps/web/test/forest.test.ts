import { describe, it, expect } from "vitest"; import { growTree } from "../src/lib/forest.js";
const apps = [{ id: "lab/app/clinic/api", name: "api", pods: 3, restarts: 0, status: "ok" as const },
              { id: "lab/app/chaos/chaos-api", name: "chaos-api", pods: 1, restarts: 2, status: "attention" as const }];
describe("forest", () => {
  it("is deterministic for the same estate", () => { expect(growTree("lab", 200, apps)).toEqual(growTree("lab", 200, apps)); });
  it("adding an app does not move the others", () => {
    const a = growTree("lab", 200, apps), b = growTree("lab", 200, [...apps, { id: "lab/app/x/y", name: "y", pods: 1, restarts: 0, status: "ok" }]);
    expect(b.branches.find(x => x.app === "api")!.leaves).toEqual(a.branches.find(x => x.app === "api")!.leaves);
  });
  it("only struggling apps get ember leaves", () => {
    const t = growTree("lab", 200, apps);
    expect(t.branches.find(b => b.app === "api")!.leaves.some(l => l.ember)).toBe(false);
    expect(t.branches.find(b => b.app === "chaos-api")!.leaves.filter(l => l.ember).length).toBeGreaterThan(0);
  });
  it("caps branches at 14", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `lab/app/n/a${i}`, name: `a${i}`, pods: 1, restarts: 0, status: "ok" as const }));
    expect(growTree("lab", 200, many).branches).toHaveLength(14);
  });
});
