import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// dev: the center runs on :8080 with CONTROL_DEV=1
export default defineConfig({ plugins: [svelte()], server: { proxy: { "/api": "http://127.0.0.1:8080" } } });
