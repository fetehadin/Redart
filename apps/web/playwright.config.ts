import { defineConfig, devices } from "@playwright/test";

// Run with `pnpm e2e` from the repo root after `pnpm build`: it provides a throwaway DATABASE_URL.
// CHROMIUM_PATH lets you use a system browser instead of Playwright's download.
const executablePath = process.env.CHROMIUM_PATH || undefined;
const WEB = "http://localhost:3100";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: WEB, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
    { name: "phone", use: { ...devices["Pixel 7"], launchOptions: { executablePath } } },
  ],
  webServer: [
    {
      command: "node ../api/dist/index.js",
      url: "http://localhost:4100/api/health",
      env: { PORT: "4100", NODE_ENV: "production", APP_ORIGIN: WEB, RATE_LIMIT_SCALE: "100", DATABASE_URL: process.env.DATABASE_URL ?? "", LOG_LEVEL: "warn" },
      reuseExistingServer: false,
    },
    {
      command: "pnpm exec next start --port 3100",
      url: WEB,
      env: { API_ORIGIN: "http://localhost:4100", INTERNAL_API_URL: "http://localhost:4100", APP_ORIGIN: WEB },
      reuseExistingServer: false,
    },
  ],
});
