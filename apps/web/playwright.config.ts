import { defineConfig, devices } from "@playwright/test";

// Runs against production builds: `pnpm build` first. CHROMIUM_PATH lets you use a system browser.
const executablePath = process.env.CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
    { name: "phone", use: { ...devices["Pixel 7"], launchOptions: { executablePath } } },
  ],
  webServer: [
    { command: "node ../api/dist/index.js", url: "http://localhost:4100/api/health", env: { PORT: "4100", NODE_ENV: "production" }, reuseExistingServer: false },
    { command: "pnpm exec next start --port 3100", url: "http://localhost:3100", env: { API_ORIGIN: "http://localhost:4100" }, reuseExistingServer: false },
  ],
});
