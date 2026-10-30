import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4173", viewport: { width: 1500, height: 1400 } },
  projects: [{ name: "chromium" }],
  webServer: { command: "vite preview --host 127.0.0.1 --port 4173 --strictPort", url: "http://127.0.0.1:4173" },
});
