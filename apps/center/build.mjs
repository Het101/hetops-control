import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"], bundle: true, platform: "node", format: "esm", target: "node22",
  outfile: "dist/main.js", sourcemap: true, external: ["better-sqlite3"],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
