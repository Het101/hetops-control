import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"], bundle: true, platform: "node", format: "esm", target: "node22",
  outfile: "dist/main.js",
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
