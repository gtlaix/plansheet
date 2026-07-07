import { defineConfig, devices } from '@playwright/test';

// In the dev sandbox the browser is pre-installed at a fixed path and may not
// match this Playwright version's expected revision; point at it via PW_CHROMIUM.
// CI leaves this unset and runs `npx playwright install chromium` instead.
const localChromium = process.env.PW_CHROMIUM;

/**
 * Hermetic UI tests: every external API is stubbed via route interception in the
 * specs, so CI never touches the live Planning Data API. The dev server is
 * enough — we test behaviour, not the production bundle.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(localChromium ? { launchOptions: { executablePath: localChromium } } : {}),
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
