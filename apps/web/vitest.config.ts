// the unit tests are pure TS; keep the Svelte plugin (Vite 6) out of vitest's Vite 5
export default { test: { include: ["test/**/*.test.ts"] } };
